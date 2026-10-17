
const express = require("express");
const adminMiddleware = require("../middleware/adminMiddleware");
const userMiddleware = require("../middleware/userMiddleware");

const {
  createProblem,
  updateProblem,
  deleteProblem,
  SolvedProblem,
  getAllProblem,
  getProblemById,
  searchProblem,
  filterProblem,
  submitSolution
} = require("../controllers/userProblem");

const problemRouter = express.Router();

// Create Problem - Admin only
problemRouter.post("/create", adminMiddleware, createProblem);

// Solved Problems - Logged-in user
problemRouter.get("/user", userMiddleware, SolvedProblem);

// Search Problems
problemRouter.get("/search", searchProblem);

// Filter Problems
problemRouter.get("/filter", filterProblem);

// Get All Problems with Pagination
problemRouter.get("/", getAllProblem);

// Submit Solution - Logged-in user
problemRouter.post("/:id/submit", userMiddleware, submitSolution);

// Get Problem by ID
problemRouter.get("/:id", getProblemById);

// Update Problem - Admin only
problemRouter.patch("/:id", adminMiddleware, updateProblem);

// Delete Problem - Admin only
problemRouter.delete("/:id", adminMiddleware, deleteProblem);

module.exports = problemRouter;
