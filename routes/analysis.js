const express = require("express");
const router = express.Router();
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

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
    const parsedClaudeResponse = parseClaudeResponse(claudeText);

    // Get all files in src directory
    const srcContentsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/src`, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    const srcFiles = await srcContentsResponse.json();

    // Get the actual content of each src file
    const functionAnalysis = {
      totalFunctions: 0,
      implementedFunctions: 0,
      functions: []
    };

    for (const file of srcFiles) {
      if (file.type === 'file' && file.name.endsWith('.js')) {
        const contentResponse = await fetch(file.url, {
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        const content = await contentResponse.json();
        const code = Buffer.from(content.content, 'base64').toString();
        
        // Parse the code and analyze functions
        try {
          const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx']
          });

          traverse(ast, {
            FunctionDeclaration(path) {
              functionAnalysis.totalFunctions++;
              const functionBody = path.node.body.body;
              
              // Check if function has implementation
              const isImplemented = functionBody.length > 0;
              if (isImplemented) functionAnalysis.implementedFunctions++;

              functionAnalysis.functions.push({
                name: path.node.id.name,
                implemented: isImplemented,
                file: file.name,
                lineCount: functionBody.length
              });
            },
            ArrowFunctionExpression(path) {
              // Similar analysis for arrow functions
              // ... 
            }
          });
        } catch (parseError) {
          console.error(`Error parsing ${file.name}:`, parseError);
        }
      }
    }

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
      deletions: filesData.reduce((sum, file) => sum + file.deletions, 0),
      functionAnalysis: {
        totalFunctions: functionAnalysis.totalFunctions,
        implementedFunctions: functionAnalysis.implementedFunctions,
        completionPercentage: (functionAnalysis.implementedFunctions / functionAnalysis.totalFunctions) * 100,
        functions: functionAnalysis.functions
      }
    };

    console.log("Data being sent to frontend:", JSON.stringify(processedResponse, null, 2));

    res.json(processedResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/analyze-file", async (req, res) => {
  try {
    const { repoUrl, filePath, rubric } = req.body;
    
    // Extract repo details
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }
    
    const [, owner, repo] = match;
    
    // Fetch specific file from GitHub
    const fileResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileData = await fileResponse.json();
    const content = Buffer.from(fileData.content, 'base64').toString();

    // Analyze functions in the file
    const functionAnalysis = {
      totalFunctions: 0,
      implementedFunctions: 0,
      functions: []
    };

    try {
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: ['jsx']
      });

      traverse(ast, {
        FunctionDeclaration(path) {
          functionAnalysis.totalFunctions++;
          const functionBody = path.node.body.body;
          
          const isImplemented = functionBody.length > 0;
          if (isImplemented) functionAnalysis.implementedFunctions++;

          functionAnalysis.functions.push({
            name: path.node.id.name,
            implemented: isImplemented,
            file: filePath,
            lineCount: functionBody.length
          });
        },
        ArrowFunctionExpression(path) {
          // Similar analysis for arrow functions
          functionAnalysis.totalFunctions++;
          const functionBody = path.node.body;
          
          const isImplemented = functionBody.type !== 'BlockStatement' || functionBody.body.length > 0;
          if (isImplemented) functionAnalysis.implementedFunctions++;
        }
      });
    } catch (parseError) {
      console.error(`Error parsing ${filePath}:`, parseError);
    }

    const processedResponse = {
      fileContent: content,
      functionAnalysis: {
        totalFunctions: functionAnalysis.totalFunctions,
        implementedFunctions: functionAnalysis.implementedFunctions,
        completionPercentage: (functionAnalysis.implementedFunctions / functionAnalysis.totalFunctions) * 100,
        functions: functionAnalysis.functions
      }
    };

    res.json(processedResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this endpoint to analyze a specific file from a PR
router.post("/analyze-pr-file", async (req, res) => {
  console.log('Received PR file analysis request');
  try {
    const { prUrl, filePath, rubric } = req.body;
    console.log('Processing PR:', prUrl);
    console.log('File path:', filePath);
    console.log('Rubric:', rubric);
    
    // Extract PR details
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid GitHub PR URL' });
    }
    
    const [, owner, repo, prNumber] = match;
    
    // First get the PR files to find the specific file
    const filesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    const filesData = await filesResponse.json();
    const targetFile = filesData.find(file => file.filename === filePath);
    
    if (!targetFile) {
      throw new Error(`File not found in PR: ${filePath}`);
    }

    // Get the raw content from the PR's version of the file
    const rawContentResponse = await fetch(targetFile.raw_url, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });

    if (!rawContentResponse.ok) {
      throw new Error(`Failed to fetch file content: ${filePath}`);
    }

    const content = await rawContentResponse.text();

    // Analyze with Claude using the same format as PR analysis
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
          content: generatePrompt([{
            filename: filePath,
            content: content,
            additions: targetFile.additions,
            deletions: targetFile.deletions
          }], rubric)
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    console.log("Claude response:", claudeData);
    const claudeText = claudeData.content[0].text;

    // Parse Claude's response
    const parsedClaudeResponse = parseClaudeResponse(claudeText);

    // Analyze functions in the file
    const functionAnalysis = {
      totalFunctions: 0,
      implementedFunctions: 0,
      functions: []
    };

    try {
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: ['jsx']
      });

      traverse(ast, {
        FunctionDeclaration(path) {
          functionAnalysis.totalFunctions++;
          const functionBody = path.node.body.body;
          
          const isImplemented = functionBody.length > 0;
          if (isImplemented) functionAnalysis.implementedFunctions++;

          functionAnalysis.functions.push({
            name: path.node.id.name,
            implemented: isImplemented,
            file: filePath,
            lineCount: functionBody.length
          });
        },
        ArrowFunctionExpression(path) {
          functionAnalysis.totalFunctions++;
          const functionBody = path.node.body;
          
          const isImplemented = functionBody.type !== 'BlockStatement' || functionBody.body.length > 0;
          if (isImplemented) functionAnalysis.implementedFunctions++;
        }
      });
    } catch (parseError) {
      console.error(`Error parsing ${filePath}:`, parseError);
    }

    // Calculate total score
    const totalScore = rubric.reduce((acc, criteria) => {
      if (criteria.criterion === 'Code Completion') {
        return acc + Math.round((functionAnalysis.completionPercentage / 100) * criteria.weight);
      }
      return acc + (parsedClaudeResponse.scores[criteria.criterion] || 0);
    }, 0);

    const processedResponse = {
      fileContent: content,
      score: totalScore,
      functionAnalysis: {
        totalFunctions: functionAnalysis.totalFunctions,
        implementedFunctions: functionAnalysis.implementedFunctions,
        completionPercentage: (functionAnalysis.implementedFunctions / functionAnalysis.totalFunctions) * 100,
        functions: functionAnalysis.functions
      },
      changes: {
        additions: targetFile.additions,
        deletions: targetFile.deletions,
        changes: targetFile.changes,
        status: targetFile.status
      },
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
      }
    };

    console.log('Sending response:', processedResponse);
    res.json(processedResponse);
  } catch (error) {
    console.error('Error in analyze-pr-file:', error);
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