const express = require("express");
const router = express.Router();

router.post("/analyze-pr", async (req, res) => {
    console.log("Analyzing PR");
  try {
    const { prUrl, rubric } = req.body;
    
    // Extract PR details
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid GitHub PR URL' });
    }
    
    const [, owner, repo, prNumber] = match;
    
    // Fetch PR files from GitHub
    const filesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    const filesData = await filesResponse.json();

    console.log("Files data:", filesData);

    const codeContent = filesData.map(file => ({
      filename: file.filename,
      content: file.patch || '',
      additions: file.additions,
      deletions: file.deletions
    }));

    console.log("Code content:", codeContent);
    
    // Analyze with Claude
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.CLAUDE_API_KEY
      },
      body: JSON.stringify({
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: generatePrompt(codeContent, rubric)
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    console.log("Claude data:", claudeData);

    const claudeText = claudeData.content[0].text;

    // Parse the Claude response to extract scores and content
    const parseClaudeResponse = (text) => {
      try {
        const jsonResponse = JSON.parse(text);
        return {
          scores: Object.fromEntries(
            jsonResponse.criteriaAnalysis.map(item => [item.criterion, item.score])
          ),
          justifications: Object.fromEntries(
            jsonResponse.criteriaAnalysis.map(item => [item.criterion, item.justification])
          ),
          recommendations: Object.fromEntries(
            jsonResponse.criteriaAnalysis.map(item => [item.criterion, item.recommendations])
          ),
          overallAnalysis: jsonResponse.overallAnalysis
        };
      } catch (error) {
        console.error('Error parsing Claude response:', error);
        return {
          scores: {},
          justifications: {},
          recommendations: {},
          overallAnalysis: ''
        };
      }
    };

    const parsedClaudeResponse = parseClaudeResponse(claudeText);

    // Process Claude's response
    const processedResponse = {
      criteriaScores: rubric.map(item => ({
        criterion: item.criterion,
        weight: item.weight,
        score: parsedClaudeResponse.scores[item.criterion] || 0,
        justification: parsedClaudeResponse.justifications[item.criterion] || '',
        recommendations: parsedClaudeResponse.recommendations[item.criterion] || []
      })),
      claudeResponse: {
        content: claudeText,
        overallAnalysis: parsedClaudeResponse.overallAnalysis
      },
      score: Object.values(parsedClaudeResponse.scores).reduce((acc, score) => acc + score, 0),
      totalFiles: filesData.length,
      additions: filesData.reduce((sum, file) => sum + file.additions, 0),
      deletions: filesData.reduce((sum, file) => sum + file.deletions, 0)
    };

    console.log("Data being sent to frontend:", JSON.stringify(processedResponse, null, 2));

    res.json(processedResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function generatePrompt(codeFiles, rubric) {
  return `You are a code review expert. Please analyze the following code changes and return your analysis in the following JSON format:

    {
      "criteriaAnalysis": [
        {
          "criterion": "criterion name",
          "score": "weighted score (numeric)",
          "justification": "detailed justification",
          "recommendations": ["recommendation1", "recommendation2"]
        }
      ],
      "overallAnalysis": "overall analysis text"
    }

    Use this specific rubric for your analysis:
    ${rubric.map(item => `
    ${item.criterion} (${item.weight}%):
    ${item.description}`).join('\n')}

    Code changes to review:
    ${codeFiles.map(file => `
    File: ${file.filename}
    Changes:
    ${file.content}
    `).join('\n')}

    Important: 
    1. Return ONLY valid JSON without any additional text or markdown
    2. Provide scores in their weighted form (e.g., for a 25% criterion, score should be between 0-25, not 0-100)
    3. Ensure recommendations are provided as an array of strings`;
}

module.exports = router; 