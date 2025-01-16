# GitHub PR Code Analyzer

This is a backend for the PR Request Grader. It is built with Express.

The app allows you to choose between analyzing a complete repo PR or a single file within a repo PR.


Demo Video:

## Features

- Create and customize grading rubrics with weights and descriptions
- Input GitHub PR URLs for analysis
- Input a GitHub repo URL and file path to analyze a single file within a repo PR
- add Rubric Criteria and weights
- View analysis results including:
  - Files changed statistics
  - Line additions/deletions
  - Scores based on custom criteria
  - Export results as text file
  - Copy results to clipboard

## Prerequisites

- Node.js and npm installed
- GitHub Personal Access Token
- Git installed

## Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd github-pr-analyzer
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

## Environment Setup

Create a `.env` file in the root directory with the following keys:
```
GITHUB_TOKEN= # Github Personal Access Token
CLAUDE_API_KEY= # Claude API Key
```

## GitHub Personal Access Token (PAT)
The `GITHUB_TOKEN` needs to be a Personal Access Token. To generate one:

1. Log in to GitHub
2. Click your profile picture in the top right
3. Go to Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
4. Click "Generate new token (classic)"
5. Give your token a name in the "Note" field (e.g., "PR Code Analyzer")
6. Set expiration as needed (e.g., 30 days)
7. Select scopes:
   - Check `repo` for full repository access
   - This includes access to PRs, code, and repository contents
8. Click "Generate token"
9. **IMPORTANT**: Copy the token immediately - you won't see it again!
10. Paste the token after `GITHUB_TOKEN=` in your `.env` file

⚠️ Security Notes:
- Never commit your `.env` file to version control
- If you accidentally expose your token, delete it immediately in GitHub and generate a new one
- Keep your tokens secure - they provide access to your GitHub account

## Generating GitHub Personal Access Token

1. Log in to GitHub
2. Click your profile picture in the top right
3. Go to Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
4. Click "Generate new token (classic)"
5. Give your token a name in the "Note" field
6. Set expiration as needed (e.g., 30 days)
7. Select scopes:
   - Check `repo` for full repository access
   - This includes PRs, code, and repository contents
8. Click "Generate token"
9. **IMPORTANT**: Copy the token immediately - you won't see it again!
10. Paste the token into your `.env` file:
    ```
    GITHUB_TOKEN=your_copied_token_here
    ```

⚠️ Never commit your `.env` file to version control
⚠️ If you accidentally expose your token, delete it immediately in GitHub and generate a new one

## Usage

1. Open the application in your browser
2. Add or modify grading criteria using the rubric editor
3. Enter a GitHub PR URL in the format: `https://github.com/owner/repo/pull/number`
4. Click "Analyze PR" to view the results
5. Export or copy results as needed



## Limitations

- Currently only analyzes files within a PR
- Requires public repository access or appropriate GitHub permissions
- Token must have repository read access

The frontend can be found [here](https://github.com/jason-s-dev/ai-grader-frontend)