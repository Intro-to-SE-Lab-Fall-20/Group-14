var mysql = require("mysql");
var express = require("express");
var session = require("express-session");
var bodyParser = require("body-parser");
var path = require("path");
const { request } = require("http");
//const { response } = require("express");

var connection = mysql.createConnection({
  host: "8.42.187.197",
  user: "newuser",
  password: "@simplepassword",
  database: "usersdb",
});

var app = express();
app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
    expires: new Date(Date.now() + 900000),
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("./", function (req, res) {
  res.sendFile(path.join(__dirname + "/index.html"));
});

app.post("/auth", function (req, res) {
  var username = req.body.username;
  var password = req.body.password;
  if (username && password) {
    connection.query(
      "SELECT * FROM userinfo WHERE usernames = ? AND passwords = ?",
      [username, password],
      function (err, results, fields) {
        if (err) throw err;
        if (results.length > 0) {
          req.session.loggedin = true;
          req.session.username = username;
          res.redirect("./landing.html");
        } else {
          res.send("Incorrect Credentials.");
        }
        res.end();
      }
    );
  } else {
    res.send("Please enter Username and Password.");
    res.end();
  }
});
/*
app.get("./", function (req, res) {
  if (req.session.loggedin) {
    res.sendFile(path.join(__dirname + "./landing.html"));
  } else {
    res.send("Please login to view this page.");
  }
  res.end();
});
*/
//app.use(express.static("./"));

var server = app.listen(3000);
