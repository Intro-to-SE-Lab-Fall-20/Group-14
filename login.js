var mysql = require("mysql");
var express = require("express");
var session = require("express-session");
var bodyParser = require("body-parser");
var path = require("path");
var AWS = require("aws-sdk");
const simpleParser = require("mailparser").simpleParser;
var app = express();

AWS.config.update({ region: "us-east-1" });

const s3 = new AWS.S3({
  apiVersion: "2006-03-01",
  credentials: {
    accessKeyId: "AKIA6LQUUTFMH2Y3LCCD",
    secretAccessKey: "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",
  },
});

var connection = mysql.createConnection({
  host: "8.42.187.197",
  user: "newuser",
  password: "@simplepassword",
  database: "usersdb",
});

app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);
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
    response.sendFile(path.join(__dirname + "/public/landing.html"));
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
  } else {
    response.send("Please login to view this page!");
  }
  //response.end();
});

app.use(express.static(__dirname + "/public"));

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
      }
    }
  );
}

app.listen(3000);
