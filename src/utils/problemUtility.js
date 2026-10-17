
const axios = require("axios");

const JUDGE0_URL = (
    process.env.JUDGE0_URL || "http://127.0.0.1:2358"
).replace(/\/+$/, "");

const LANGUAGE_IDS = {
    cpp: 54,
    "c++": 54,
    java: 62,
    javascript: 63,
    js: 63,
    python: 71,
    python3: 71,
    c: 50
};

const getLanguageById = (language) => {
    if (typeof language !== "string") {
        return null;
    }

    return LANGUAGE_IDS[language.trim().toLowerCase()] ?? null;
};

// Decode Base64 strings returned by Judge0.
const decodeBase64 = (value) => {
    if (value === null || value === undefined || value === "") {
        return value;
    }

    return Buffer.from(value, "base64").toString("utf8");
};

// Submit test cases to Judge0.
const submitBatch = async (submissions) => {
    if (!Array.isArray(submissions) || submissions.length === 0) {
        throw new Error("Submissions must be a non-empty array");
    }

    const payload = submissions.map((item) => {
        if (
            typeof item.source_code !== "string" ||
            !Number.isInteger(Number(item.language_id))
        ) {
            throw new Error("Invalid source_code or language_id");
        }

        return {
            source_code: item.source_code,
            language_id: Number(item.language_id),
            stdin: item.stdin ?? "",
            expected_output: item.expected_output ?? ""
        };
    });

    try {
        const response = await axios.post(
            `${JUDGE0_URL}/submissions/batch`,
            {
                submissions: payload
            },
            {
                params: {
                    base64_encoded: "false",
                    wait: "false"
                },
                timeout: 20000
            }
        );

        if (!Array.isArray(response.data)) {
            throw new Error("Invalid response from Judge0");
        }

        return response.data;
    } catch (error) {
        console.error(
            "Judge0 submission error:",
            error.response?.data || error.message
        );

        throw new Error(
            `Judge0 submission failed: ${
                error.response?.data?.error || error.message
            }`
        );
    }
};

// Fetch and decode execution results.
const submitToken = async (tokens) => {
    if (!Array.isArray(tokens) || tokens.length === 0) {
        throw new Error("Tokens must be a non-empty array");
    }

    try {
        const response = await axios.get(
            `${JUDGE0_URL}/submissions/batch`,
            {
                params: {
                    tokens: tokens.join(","),
                    base64_encoded: "true",
                    fields: "token,stdout,stderr,compile_output,status,time,memory"
                },
                timeout: 20000
            }
        );

        if (!Array.isArray(response.data?.submissions)) {
            throw new Error("Invalid results from Judge0");
        }

        return response.data.submissions.map((result) => ({
            ...result,
            stdout: decodeBase64(result.stdout),
            stderr: decodeBase64(result.stderr),
            compile_output: decodeBase64(result.compile_output)
        }));
    } catch (error) {
        console.error(
            "Judge0 result retrieval error:",
            error.response?.data || error.message
        );

        throw new Error(
            `Judge0 result retrieval failed: ${
                error.response?.data?.error || error.message
            }`
        );
    }
};

// Submit, poll until execution finishes, and preserve test-case order.
const runSubmissions = async (submissions) => {
    const batchResponse = await submitBatch(submissions);

    if (
        batchResponse.length !== submissions.length ||
        batchResponse.some((item) => !item.token)
    ) {
        throw new Error("Judge0 did not return all submission tokens");
    }

    const tokens = batchResponse.map((item) => item.token);

    for (let attempt = 0; attempt < 40; attempt++) {
        const fetchedResults = await submitToken(tokens);

        const resultsByToken = new Map(
            fetchedResults.map((result) => [result.token, result])
        );

        const orderedResults = tokens.map((token) =>
            resultsByToken.get(token)
        );

        const allCompleted = orderedResults.every(
            (result) => result?.status && result.status.id > 2
        );

        if (allCompleted) {
            return orderedResults;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Judge0 execution timed out");
};

module.exports = {
    LANGUAGE_IDS,
    getLanguageById,
    submitBatch,
    submitToken,
    runSubmissions
};
