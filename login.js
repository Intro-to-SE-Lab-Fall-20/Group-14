var mysql = require("mysql");
var express = require("express");
var session = require("express-session");
var bodyParser = require("body-parser");
var path = require("path");
var AWS = require("aws-sdk");
const simpleParser = require("mailparser").simpleParser;
const fs = require("fs");
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/private/config.json"))
);

var app = express();

AWS.config.update({ region: "us-east-1" });

const s3 = new AWS.S3({
  apiVersion: "2006-03-01",
  credentials: {
    accessKeyId: config["S3access"],
    secretAccessKey: config["S3secret"],
  },
});

var connection = mysql.createConnection({
  host: config["sqlHost"],
  user: config["sqlUser"],
  password: config["sqlPassword"],
  database: config["sqlDatabase"],
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);

app.use(express.static(__dirname + "/public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/", function (request, response) {
  response.sendFile(path.join(__dirname + "/public/login.html"));
});

app.post("/auth", function (request, response) {
  var username = request.body.username;
  var password = request.body.password;
  if (username && password) {
    connection.query(
      "SELECT * FROM userinfo WHERE usernames = ? AND passwords = ?",
      [username, password],
      function (error, results, fields) {
        if (results.length > 0) {
          request.session.loggedin = true;
          request.session.username = username;
          response.redirect("/landing");
        } else {
          response.send("Incorrect Username and/or Password!");
        }
      }
    );
  } else {
    response.send("Please enter a Username and Password!");
  }
});

app.post("/regi", function (request, response) {
  var reg_username = request.body.reg_username;
  var reg_password = request.body.reg_password;
  if (reg_username && reg_password) {
    connection.query(
      "SELECT * FROM userinfo WHERE usernames = ?",
      [reg_username],
      function (error, results, fields) {
        if (error) throw error;
        if (results.length == 0) {
          connection.query(
            "INSERT INTO userinfo (usernames, passwords, addresses) VALUES (?,?,?)",
            [reg_username, reg_password, reg_username + "@zetalogo.com"],
            function (error, results, fields) {
              if (error) {
                throw error;
              } else {
                console.log("Inserted Record");

                //call to aws-sdk SES functions
                rule_address(reg_username);

                response.redirect("/");
              }
            }
          );
        } else {
          response.send("Username already taken.");
        }
      }
    );
  } else {
    response.send("Please enter a Username and Password!");
  }
});

app.get("/landing", function (request, response) {
  //console.log("request was made: " + request.url);
  if (request.session.loggedin) {
    //response.sendFile(path.join(__dirname + "/public/landing.html"));
    console.log(request.session.username);
    //put the email insert code over here
    const usn = request.session.username;
    const bucket = {
      Bucket: "zetalogo-mail",
      Prefix: usn + "/",
    };
    s3.listObjectsV2(bucket, function (err, listObjectsV2result) {
      if (err) {
        console.log(err);
        return;
      }
      listObjectsV2result.Contents.map((o, i) => {
        grabObject(o.Key, usn);
      });
    });

    var email_array = [];
    connection.query(
      "SELECT * FROM emails WHERE usernames = ?",
      [request.session.username],
      function (error, results, fields) {
        for (const object in results) {
          email_array.push([
            results[object]["id"],
            results[object]["sender"],
            results[object]["subjects"],
          ]);
        }
        response.render("landing", {
          emails: email_array,
          inbox: true,
          username: request.session.username,
        });
        //console.log(email_array);
      }
    );
  } else {
    response.send("Please login to view this page!");
  }
});

app.get("/landing/:id", function (req, res) {
  if (req.session.loggedin) {
    console.log("requesting email id: " + req.params.id);
    var email_array = [];
    connection.query(
      "SELECT * FROM emails where id = ? AND usernames = ?",
      [req.params.id, req.session.username],
      function (error, results, fields) {
        for (const object in results) {
          email_array.push([
            results[object]["sender"],
            results[object]["subjects"],
            results[object]["body"],
          ]);
        }
        res.render("landing", {
          emails: email_array,
          inbox: false,
          username: req.session.username,
        });
        //console.log(email_array);
      }
    );
  } else {
    response.send("Please login to view this page!");
  }
});

app.post("/landing/search", function (req, res) {
  //res.send("You searched for: " + req.body.search_query);
  if (req.session.loggedin) {
    var email_array = [];
    connection.query(
      "SELECT * FROM emails WHERE usernames = ? AND (subjects LIKE ? OR sender LIKE ? OR body LIKE ? OR dates LIKE ?)",
      [
        req.session.username,
        "%" + req.body.search_query + "%",
        "%" + req.body.search_query + "%",
        "%" + req.body.search_query + "%",
        "%" + req.body.search_query + "%",
      ],
      function (error, results, fields) {
        for (const object in results) {
          email_array.push([
            results[object]["id"],
            results[object]["sender"],
            results[object]["subjects"],
          ]);
        }
        res.render("landing", {
          emails: email_array,
          inbox: true,
          searchbar: false,
          username: req.session.username,
        });
        console.log("Searched for " + req.body.search_query);
      }
    );
  } else {
    res.send("Please login to view this page!");
  }
});

function rule_address(usn) {
  var key_prefix = usn + "/";
  var recipient = usn + "@zetalogo.com";
  var rule_name = usn + "-rule";
  var rule_params = {
    //note that excluding the 'After' parameter
    //will make the rule be added to the beginning
    Rule: {
      Actions: [
        {
          S3Action: {
            BucketName: "zetalogo-mail",
            ObjectKeyPrefix: key_prefix,
          },
        },
      ],
      Recipients: [recipient],
      Enabled: true,
      Name: rule_name,
      ScanEnabled: true,
      TlsPolicy: "Optional",
    },
    RuleSetName: "default-rule-set",
  };
  var newRulePromise = new AWS.SES({ apiVersion: "2010-12-01" })
    .createReceiptRule(rule_params)
    .promise();

  newRulePromise
    .then(function (data) {
      console.log("Rule created");
    })
    .catch(function (err) {
      console.error(err, err.stack);
    });
  /* var verifyEmailPromise = new AWS.SES({ apiVersion: "2010-12-01" })
    .sendCustomVerificationEmail({
      EmailAddress: recipient,
      TemplateName: "EmailVerification",
    })
    .promise();

  verifyEmailPromise
    .then(function (data) {
      console.log("Email verification initiated");
    })
    .catch(function (err) {
      console.error(err, err.stack);
    }); */
}

async function grabObject(key, usn) {
  const request = {
    Bucket: "zetalogo-mail",
    Key: key,
  };
  console.log("Grabbing a single object:");
  const data = await s3.getObject(request).promise();
  //await s3.deleteObject(request).promise();
  //delete statement goes here: ? call await s3.deleteObject(request).promise()
  const email = await simpleParser(data.Body);
  //console.log("attachments:" + email.attachments);
  connection.query(
    "INSERT INTO emails (usernames,dates,subjects,body,sender) VALUES (?,?,?,?,?)",
    [usn, email.date, email.subject, email.text, email.from.text],
    function (error, results, fields) {
      if (error) {
        throw error;
      } else {
        console.log("Inserted email into emails db");
        s3.deleteObject(request, function (err, data) {
          if (err) console.log(err, err.stack);
          else console.log("Deleted an object");
        });
      }
    }
  );
}

app.listen(3000);
