const mysql = require("mysql");
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const AWS = require("aws-sdk");
const simpleParser = require("mailparser").simpleParser;
const multer = require("multer");
const fs = require("fs");
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/private/config.json"))
);
const timeout = 1; //minutes before session times out

AWS.config.update({ region: "us-east-1" });

const s3 = new AWS.S3({
  apiVersion: "2006-03-01",
  credentials: {
    accessKeyId: config["S3access"],
    secretAccessKey: config["S3secret"],
  },
});

const SES = new AWS.SES({
  apiVersion: "2010-12-01",
  credentials: {
    accessKeyId: config["S3access"],
    secretAccessKey: config["S3secret"],
  },
});

var MailComposer = require("nodemailer/lib/mail-composer");
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
var app = express();

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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/", function (req, res) {
  res.render("reg-log", {
    register: false,
    login: true,
    reminder: "",
  });
});

app.get("/register", function (req, res) {
  res.render("reg-log", {
    register: true,
    login: false,
    reminder: "",
  });
});

app.get("/login", function (req, res) {
  res.render("reg-log", {
    register: false,
    login: true,
    reminder: "",
  });
});

app.post("/auth", function (req, res) {
  var username = req.body.username;
  var password = req.body.password;
  connection.query(
    "SELECT * FROM userinfo WHERE usernames = ? AND passwords = ?",
    [username, password],
    function (err, results, fields) {
      if (results.length > 0) {
        req.session.loggedin = true;
        req.session.username = username;
        //req.session.cookie.maxAge = timeout * 60 * 1000;
        res.redirect("landing");
      } else {
        res.render("reg-log", {
          register: false,
          login: true,
          reminder: "Incorrect Username and/or Password!",
        });
      }
    }
  );
});

app.post("/regi", function (req, res) {
  var reg_username = req.body.reg_username;
  var reg_password = req.body.reg_password;
  connection.query(
    "SELECT * FROM userinfo WHERE usernames = ?",
    [reg_username],
    function (err, results, fields) {
      if (err) throw err;
      if (results.length == 0) {
        connection.query(
          "INSERT INTO userinfo (usernames, passwords, addresses) VALUES (?,?,?)",
          [reg_username, reg_password, reg_username + "@zetalogo.com"],
          function (err, results, fields) {
            if (err) throw err;
            console.log("Registered User");
            rule_address(reg_username);
            res.render("reg-log", {
              register: false,
              login: true,
              reminder: "Registration Successful!",
            });
          }
        );
      } else {
        res.render("reg-log", {
          register: true,
          login: false,
          reminder: "Username already taken!",
        });
      }
    }
  );
});

app.get("/landing", async function (req, res) {
  if (req.session.loggedin) {
    const usn = req.session.username;
    const bucket = {
      Bucket: "zetalogo-mail",
      Prefix: usn + "/",
    };
    const results = await s3.listObjectsV2(bucket).promise();
    for (const item of results.Contents) {
      grabObject(item.Key, usn);
    }
    var email_array = [];
    const { result: inbox } = await query1`
    SELECT * FROM emails WHERE usernames = ${req.session.username}`;
    for (const object in inbox) {
      email_array.push([
        inbox[object]["idemails"],
        inbox[object]["sender"],
        inbox[object]["subjects"],
        inbox[object]["dates"],
      ]);
    }
    res.render("landing", {
      emails: email_array,
      inbox: true,
      username: req.session.username,
    });
  } else {
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.get("/landing/:id", async function (req, res) {
  if (req.session.loggedin) {
    //placeholder
    var has_att = false;
    var email_array = [];
    var att_array = [];
    const { result: single } = await query1`
    SELECT * FROM emails WHERE idemails = ${req.params.id} AND usernames = ${req.session.username}`;
    for (const object in single) {
      email_array.push([
        single[object]["sender"],
        single[object]["subjects"],
        single[object]["body"],
        single[object]["dates"],
      ]);
    }
    const { result: att } = await query1`
    SELECT * FROM attachments WHERE idemails = ${req.params.id}`;
    if (att.length !== 0) {
      has_att = true;
      for (const object in att) {
        att_array.push([att[object]["idattachments"], att[object]["filename"]]);
      }
      res.render("landing", {
        emails: email_array,
        inbox: false,
        username: req.session.username,
        has_atts: has_att,
        atts: att_array,
      });
    } else {
      res.render("landing", {
        emails: email_array,
        inbox: false,
        username: req.session.username,
        has_atts: has_att,
      });
    }
  } else {
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.post("/landing/search", function (req, res) {
  if (req.session.loggedin) {
    //placeholder
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
            results[object]["idemails"],
            results[object]["sender"],
            results[object]["subjects"],
            results[object]["dates"],
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
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.get("/compose", function (req, res) {
  if (req.session.loggedin) {
    //placeholder
    res.render("compose", {
      forward: false,
    });
  } else {
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.post("/forward", function (req, res) {
  if (req.session.loggedin) {
    //placeholder
    var sender = req.body.email_sender;
    var subject = req.body.email_subject;
    var body = req.body.email_body;
    var date = req.body.email_date;
    res.render("compose", {
      forward: true,
      fsender: sender,
      fsubject: subject,
      fbody: body,
      fdate: date,
    });
  } else {
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.post("/send", upload.single("attach-file"), function (req, res) {
  if (req.session.loggedin) {
    //placeholder
    if (typeof req.file !== "undefined") {
      var mailOptions = {
        from: req.session.username + "@zetalogo.com",
        sender: req.session.username + "@zetalogo.com",
        to: req.body.send_to,
        subject: req.body.send_subject,
        html: req.body.send_body,
        attachments: [
          {
            filename: req.file.originalname,
            content: req.file.buffer.toString("base64"),
            encoding: "base64",
          },
        ],
      };
    } else {
      var mailOptions = {
        from: req.session.username + "@zetalogo.com",
        sender: req.session.username + "@zetalogo.com",
        to: req.body.send_to,
        subject: req.body.send_subject,
        html: req.body.send_body,
      };
    }
    var mail = new MailComposer(mailOptions);
    mail.compile().build(function (err, message) {
      var params = {
        RawMessage: {
          Data: message,
        },
      };
      SES.sendRawEmail(params, function (err, data) {
        if (err) console.log("An error occured calling sendRawEmail");
        else {
          console.log("sendRawEmail succeeded");
          res.redirect("/landing");
        }
      });
    });
  } else {
    res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    });
  }
});

app.get("attachments/:id", async function (req, res) {
  if (req.session.loggedin) {
    const { result: attres } = await query1`SELECT * FROM attachments 
    WHERE idattachments = ${req.params.id} AND usernames = ${req.session.username}`;
    var fileData = new Buffer.from(attres[0]["content"]);
    res.writeHead(200, {
      "Content-Type": attres[0]["contentType"],
      "Content-Disposition":
        attres[0]["contentDisposition"] +
        "; filename=" +
        encodeURI(attres[0]["filename"]),
      "Content-Length": fileData.length,
    });
    res.write(fileData);
    res.end();
  } else {
    //placeholder
    res.redirect("/");
    /* res.render("reg-log", {
      register: false,
      login: true,
      reminder: "Please log back in.",
    }); */
  }
});

function rule_address(usn) {
  var key_prefix = usn + "/";
  var recipient = usn + "@zetalogo.com";
  var rule_name = usn + "-rule";
  var rule_params = {
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
  var newRulePromise = SES.createReceiptRule(rule_params).promise();

  newRulePromise
    .then(function (data) {
      console.log("Rule created");
    })
    .catch(function (err) {
      console.error(err, err.stack);
    });
}

async function grabObject(key, usn) {
  const request = {
    Bucket: "zetalogo-mail",
    Key: key,
  };
  console.log("Grabbing a single object:");
  const data = await s3.getObject(request).promise();
  const email = await simpleParser(data.Body);

  await query1`
    INSERT INTO emails (usernames,dates,subjects,body,sender)
    VALUES (
        ${usn},
        ${email.date},
        ${email.subject},
        ${email.text},
        ${email.from.text}
    )`;
  const { result: lastId } = await query1`SELECT LAST_INSERT_ID() AS id`;
  const emailId = lastId[0].id;
  console.log("Email ID last inserted is: " + emailId);
  console.log("There are this many attachments: " + email.attachments.length);
  console.log("First attachments is: " + email.attachments[0]["filename"]);
  /* for (i = 0; i < email.attachments.length; i++) {
    connection.query(
      "INSERT INTO attachments (idemails,usernames,filename,content,contentType,contentDisposition) VALUES (?,?,?,?,?,?)",
      [
        emailId,
        usn,
        email.attachments[i]["filename"],
        email.attachments[i]["content"],
        email.attachments[i]["contentType"],
        email.attachments[i]["contentDisposition"],
      ]
    );
  } */
  for (i = 0; i < email.attachments.length; i++) {
    filename = email.attachments[i]["filename"];
    content = email.attachments[i]["content"];
    contentType = email.attachments[i]["contentType"];
    contentDisposition = email.attachments[i]["contentDisposition"];
    await query1`
      INSERT INTO attachments (idemails,usernames,filename,content,contentType,contentDisposition)
      VALUES (
          ${emailId},
          ${usn},
          ${filename},
          ${content},
          ${contentType},
          ${contentDisposition}
      )`;
  }
  s3.deleteObject(request, function (err, data) {
    if (err) console.log(err, err.stack);
    console.log("Deleted an object");
  });
}

function query1(queryParts, ...params) {
  return new Promise((resolve, reject) => {
    const sql = queryParts.join(" ? ");
    connection.query(sql, params, (error, result, fields) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ result, fields });
    });
  });
}

app.listen(3000);
