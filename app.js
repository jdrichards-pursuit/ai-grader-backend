const express = require("express");
const cors = require("cors");
const analysisRouter = require("./routes/analysis");

const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ROUTES
app.get("/", (req, res) => {
  res.send("Welcome to Pull Request Grader");
});

app.use("/api/analysis", analysisRouter);

// 404 PAGE
app.get("*", (req, res) => {
  res.json({ error: "Page not found" });
});
// EXPORT
module.exports = app;
