
const mongoose = require("mongoose");
const User = require("../models/user");
const Problem = require("../models/problem");

const {
  getLanguageById,
  runSubmissions
} = require("../utils/problemUtility");

// Normalize output for comparison
const normalizeOutput = (value) =>
  String(value ?? "").trim().replace(/\r\n/g, "\n");

// Build executable code from stored template
const buildExecutableCode = (template, userCode) => {
  if (
    !template ||
    typeof template.prefixCode !== "string" ||
    typeof template.functionSignature !== "string" ||
    typeof template.suffixCode !== "string" ||
    typeof userCode !== "string"
  ) {
    throw new Error("Invalid code template or solution body");
  }

  return [
    template.prefixCode,
    "\n",
    template.functionSignature,
    userCode,
    "\n",
    template.suffixCode
  ].join("");
};

// Validate test cases
const validateTestCases = (testCases) =>
  Array.isArray(testCases) &&
  testCases.length > 0 &&
  testCases.every(
    (testCase) =>
      typeof testCase.input === "string" &&
      typeof testCase.output === "string"
  );

// Validate code templates
const validateCodeTemplates = (templates) =>
  Array.isArray(templates) &&
  templates.length > 0 &&
  templates.every(
    (template) =>
      typeof template.language === "string" &&
      getLanguageById(template.language) &&
      typeof template.prefixCode === "string" &&
      typeof template.functionSignature === "string" &&
      typeof template.suffixCode === "string"
  );

// Validate reference solutions
const validateReferenceSolutions = async (
  referenceSolutions,
  codeTemplates,
  visibleTestCases
) => {
  if (
    !Array.isArray(referenceSolutions) ||
    referenceSolutions.length === 0
  ) {
    return {
      valid: false,
      message: "Reference solutions cannot be empty"
    };
  }

  for (const solution of referenceSolutions) {
    if (
      typeof solution.language !== "string" ||
      typeof solution.completeCode !== "string" ||
      !solution.completeCode.trim()
    ) {
      return {
        valid: false,
        message: "Invalid reference solution"
      };
    }

    const template = codeTemplates.find(
      (item) =>
        item.language.toLowerCase() ===
        solution.language.toLowerCase()
    );

    if (!template || !getLanguageById(solution.language)) {
      return {
        valid: false,
        message: `Missing template or unsupported language: ${solution.language}`
      };
    }

    const sourceCode = buildExecutableCode(
      template,
      solution.completeCode
    );

    const results = await runSubmissions(
      visibleTestCases.map((testCase) => ({
        source_code: sourceCode,
        language_id: getLanguageById(solution.language),
        stdin: testCase.input,
        expected_output: testCase.output
      }))
    );

    if (
      !Array.isArray(results) ||
      results.length !== visibleTestCases.length
    ) {
      return {
        valid: false,
        message: `Judge0 returned an invalid result for ${solution.language}`
      };
    }

    const failedIndex = results.findIndex(
      (result, index) =>
        result?.status?.id !== 3 ||
        normalizeOutput(result.stdout) !==
          normalizeOutput(visibleTestCases[index].output)
    );

    if (failedIndex !== -1) {
      const failed = results[failedIndex];

      return {
        valid: false,
        message: "Reference solution failed a visible test case",
        language: solution.language,
        status: failed?.status?.description || "Execution Error",
        stderr: failed?.stderr || null,
        compile_output: failed?.compile_output || null,
        actual_output: failed?.stdout ?? null,
        expected_output: visibleTestCases[failedIndex].output
      };
    }
  }

  return { valid: true };
};

// Shared pagination helper
const getPagination = (query) => {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedLimit = Number.parseInt(query.limit, 10);

  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0
      ? parsedPage
      : 1;

  const limit =
    Number.isSafeInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 10;

  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
};

// Safe fields for problem list responses
const PUBLIC_PROBLEM_FIELDS =
  "title description difficulty tags visibleTestCases startCode codeTemplates createdAt updatedAt";

// CREATE PROBLEM
const createProblem = async (req, res) => {
  try {
    const {
      title,
      description,
      difficulty,
      tags,
      visibleTestCases,
      hiddenTestCases,
      startCode,
      codeTemplates,
      referenceSolution
    } = req.body;

    if (
      !title ||
      !description ||
      !difficulty ||
      !Array.isArray(tags) ||
      tags.length === 0 ||
      !validateTestCases(visibleTestCases) ||
      !validateTestCases(hiddenTestCases) ||
      !Array.isArray(startCode) ||
      startCode.length === 0 ||
      !validateCodeTemplates(codeTemplates) ||
      !Array.isArray(referenceSolution) ||
      referenceSolution.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields with valid values"
      });
    }

    const problemCreator = req.result?._id;

    if (!problemCreator) {
      return res.status(401).json({
        success: false,
        message: "Please login before creating a problem"
      });
    }

    const validation = await validateReferenceSolutions(
      referenceSolution,
      codeTemplates,
      visibleTestCases
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        ...validation
      });
    }

    const problem = await Problem.create({
      title,
      description,
      difficulty,
      tags,
      visibleTestCases,
      hiddenTestCases,
      startCode,
      codeTemplates,
      referenceSolution,
      problemCreator
    });

    return res.status(201).json({
      success: true,
      message: "Problem created successfully",
      data: {
        _id: problem._id,
        title: problem.title,
        difficulty: problem.difficulty
      }
    });
  } catch (error) {
    console.error("Create Problem Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create problem",
      error: error.message
    });
  }
};

// GET ALL PROBLEMS WITH PAGINATION
const getAllProblem = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const [problems, total] = await Promise.all([
      Problem.find({})
        .select(PUBLIC_PROBLEM_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Problem.countDocuments({})
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: problems
    });
  } catch (error) {
    console.error("Get All Problems Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch problems"
    });
  }
};

// SEARCH PROBLEMS BY TITLE
const searchProblem = async (req, res) => {
  try {
    const title = req.query.title?.trim();

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Please provide a title to search"
      });
    }

    const { page, limit, skip } = getPagination(req.query);

    // Escape special regex characters in user input
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      title: {
        $regex: escapedTitle,
        $options: "i"
      }
    };

    const [problems, total] = await Promise.all([
      Problem.find(query)
        .select(PUBLIC_PROBLEM_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Problem.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: problems
    });
  } catch (error) {
    console.error("Search Problems Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to search problems"
    });
  }
};

// FILTER PROBLEMS BY DIFFICULTY AND TAG
const filterProblem = async (req, res) => {
  try {
    const { difficulty, tag } = req.query;
    const query = {};

    if (!difficulty && !tag) {
      return res.status(400).json({
        success: false,
        message: "Provide difficulty or tag to filter problems"
      });
    }

    if (difficulty) {
      const normalizedDifficulty = difficulty.toLowerCase();

      if (!["easy", "medium", "hard"].includes(normalizedDifficulty)) {
        return res.status(400).json({
          success: false,
          message: "Difficulty must be easy, medium, or hard"
        });
      }

      query.difficulty = normalizedDifficulty;
    }

    if (tag) {
      query.tags = tag;
    }

    const { page, limit, skip } = getPagination(req.query);

    const [problems, total] = await Promise.all([
      Problem.find(query)
        .select(PUBLIC_PROBLEM_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Problem.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      filters: {
        difficulty: difficulty || null,
        tag: tag || null
      },
      data: problems
    });
  } catch (error) {
    console.error("Filter Problems Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to filter problems"
    });
  }
};

// GET PROBLEM BY ID
const getProblemById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem ID"
      });
    }

    const problem = await Problem.findById(id)
      .select(PUBLIC_PROBLEM_FIELDS)
      .lean();

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: problem
    });
  } catch (error) {
    console.error("Get Problem By ID Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch problem"
    });
  }
};

// UPDATE PROBLEM
const updateProblem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem ID"
      });
    }

    const allowedFields = [
      "title",
      "description",
      "difficulty",
      "tags",
      "visibleTestCases",
      "hiddenTestCases",
      "startCode",
      "codeTemplates",
      "referenceSolution"
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one field to update"
      });
    }

    const problem = await Problem.findById(id)
      .select("+hiddenTestCases +referenceSolution");

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found"
      });
    }

    const next = {
      title: updates.title ?? problem.title,
      description: updates.description ?? problem.description,
      difficulty: updates.difficulty ?? problem.difficulty,
      tags: updates.tags ?? problem.tags,
      visibleTestCases:
        updates.visibleTestCases ?? problem.visibleTestCases,
      hiddenTestCases:
        updates.hiddenTestCases ?? problem.hiddenTestCases,
      startCode: updates.startCode ?? problem.startCode,
      codeTemplates: updates.codeTemplates ?? problem.codeTemplates,
      referenceSolution:
        updates.referenceSolution ?? problem.referenceSolution
    };

    if (
      !next.title ||
      !next.description ||
      !next.difficulty ||
      !Array.isArray(next.tags) ||
      next.tags.length === 0 ||
      !validateTestCases(next.visibleTestCases) ||
      !validateTestCases(next.hiddenTestCases) ||
      !Array.isArray(next.startCode) ||
      next.startCode.length === 0 ||
      !validateCodeTemplates(next.codeTemplates) ||
      !Array.isArray(next.referenceSolution) ||
      next.referenceSolution.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Updated problem contains missing or invalid fields"
      });
    }

    const validation = await validateReferenceSolutions(
      next.referenceSolution,
      next.codeTemplates,
      next.visibleTestCases
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        ...validation
      });
    }

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        problem[field] = updates[field];
      }
    }

    await problem.save();

    return res.status(200).json({
      success: true,
      message: "Problem updated successfully",
      data: {
        _id: problem._id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        tags: problem.tags
      }
    });
  } catch (error) {
    console.error("Update Problem Error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Problem validation failed",
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update problem",
      error: error.message
    });
  }
};

// DELETE PROBLEM
const deleteProblem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem ID"
      });
    }

    const deletedProblem = await Problem.findByIdAndDelete(id);

    if (!deletedProblem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Problem deleted successfully",
      data: {
        _id: deletedProblem._id,
        title: deletedProblem.title
      }
    });
  } catch (error) {
    console.error("Delete Problem Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete problem"
    });
  }
};

// SUBMIT SOLUTION
const submitSolution = async (req, res) => {
  try {
    const { id } = req.params;
    const { language, code } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem ID"
      });
    }

    if (
      typeof language !== "string" ||
      typeof code !== "string" ||
      !code.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "language and code are required"
      });
    }

    const authenticatedUser = req.result;

    if (!authenticatedUser?._id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    const problem = await Problem.findById(id)
      .select("+hiddenTestCases");

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found"
      });
    }

    const languageId = getLanguageById(language);

    if (!languageId) {
      return res.status(400).json({
        success: false,
        message: "Unsupported language"
      });
    }

    const template = problem.codeTemplates.find(
      (item) =>
        item.language.toLowerCase() === language.toLowerCase()
    );

    if (!template) {
      return res.status(400).json({
        success: false,
        message: "Execution template not configured for this language"
      });
    }

    const sourceCode = buildExecutableCode(template, code);

    const testCases = [
      ...problem.visibleTestCases.map((testCase) => ({
        input: testCase.input,
        output: testCase.output,
        hidden: false
      })),
      ...problem.hiddenTestCases.map((testCase) => ({
        input: testCase.input,
        output: testCase.output,
        hidden: true
      }))
    ];

    const results = await runSubmissions(
      testCases.map((testCase) => ({
        source_code: sourceCode,
        language_id: languageId,
        stdin: testCase.input,
        expected_output: testCase.output
      }))
    );

    if (!Array.isArray(results) || results.length !== testCases.length) {
      return res.status(502).json({
        success: false,
        message: "Judge0 returned an invalid result"
      });
    }

    const failedIndex = results.findIndex(
      (result, index) =>
        result?.status?.id !== 3 ||
        normalizeOutput(result.stdout) !==
          normalizeOutput(testCases[index].output)
    );

    if (failedIndex !== -1) {
      const failed = results[failedIndex];
      const failedTestCase = testCases[failedIndex];

      let verdict = failed?.status?.description || "Execution Error";

      if (failed?.status?.id === 6) {
        verdict = "Compilation Error";
      } else if (failed?.status?.id === 5) {
        verdict = "Time Limit Exceeded";
      } else if (failed?.status?.id === 11) {
        verdict = "Runtime Error";
      } else if (failed?.status?.id === 3) {
        verdict = "Wrong Answer";
      }

      return res.status(200).json({
        success: true,
        verdict,
        passedTestCases: failedIndex,
        totalTestCases: testCases.length,
        failedTestCase: failedTestCase.hidden
          ? undefined
          : {
              input: failedTestCase.input,
              expectedOutput: failedTestCase.output,
              actualOutput: failed.stdout ?? null
            },
        error: failed?.stderr || failed?.compile_output || null
      });
    }

    await User.findByIdAndUpdate(
      authenticatedUser._id,
      { $addToSet: { problem_solve: problem._id } }
    );

    return res.status(200).json({
      success: true,
      verdict: "Accepted",
      passedTestCases: testCases.length,
      totalTestCases: testCases.length
    });
  } catch (error) {
    console.error("Submit Solution Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to execute solution",
      error: error.message
    });
  }
};

// GET SOLVED PROBLEMS
const SolvedProblem = async (req, res) => {
  try {
    const authenticatedUser = req.result;

    if (!authenticatedUser?._id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    const user = await User.findById(authenticatedUser._id)
      .select("problem_solve")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const solvedProblemIds = user.problem_solve || [];

    if (!Array.isArray(solvedProblemIds) || solvedProblemIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: "No solved problems found",
        data: []
      });
    }

    const problems = await Problem.find({
      _id: { $in: solvedProblemIds }
    })
      .select("title description difficulty tags")
      .lean();

    return res.status(200).json({
      success: true,
      count: problems.length,
      data: problems
    });
  } catch (error) {
    console.error("SolvedProblem Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch solved problems"
    });
  }
};

module.exports = {
  createProblem,
  getAllProblem,
  searchProblem,
  filterProblem,
  getProblemById,
  updateProblem,
  deleteProblem,
  SolvedProblem,
  submitSolution
};
