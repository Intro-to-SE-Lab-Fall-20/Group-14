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

const bucket = {
  Bucket: "zetalogo-mail",
  Prefix: "joe" + "/",
};
app.get("/", function (req, res) {
  s3.listObjectsV2(bucket, function (err, listObjectsV2result) {
    if (err) {
      console.log(err);
      return;
    }
    listObjectsV2result.Contents.map((o, i) => {
      getAttachment(o.Key, "joe");
      console.log("got and printed attachment filename");
      res.send("Finished(maybe?) inserting attachments");
    });
  });
});

async function getAttachment(key, usn) {
  const request = {
    Bucket: "zetalogo-mail",
    Key: key,
  };
  const data = await s3.getObject(request).promise();
  const email = await simpleParser(data.Body);

  connection.query(
    "INSERT INTO testattachments (filename,content,contentType,contentDisposition) VALUES (?,?,?,?)",
    [
      email.attachments[0]["filename"],
      email.attachments[0]["content"],
      email.attachments[0]["contentType"],
      email.attachments[0]["contentDisposition"],
    ],
    function (error, results, fields) {
      if (error) {
        console.log("Error with query insert statement");
      } else {
        console.log("Insert attachment into test table");
      }
    }
  );
  console.log(
    "filename: " +
      email.attachments[0]["filename"] +
      " contentType: " +
      email.attachments[0]["contentType"]
  );
}

app.listen(3000);
