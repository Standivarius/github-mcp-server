import express from 'express';
import cors from 'cors';
import { Octokit } from '@octokit/rest';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Validate environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const MCP_API_KEY = process.env.MCP_API_KEY;

console.log('Environment check:');
console.log('- GITHUB_TOKEN exists:', !!GITHUB_TOKEN);
console.log('- GITHUB_TOKEN length:', GITHUB_TOKEN?.length || 0);
console.log('- MCP_API_KEY exists:', !!MCP_API_KEY);
console.log('- All env vars:', Object.keys(process.env).filter(k => k.includes('GITHUB') || k.includes('MCP')));

if (!GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Auth disabled for ChatGPT compatibility
const authenticate = (req, res, next) => {
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MCP SSE endpoint
app.get('/sse', authenticate, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send MCP server metadata
  const metadata = {
    name: 'github-mcp-server',
    version: '1.0.0',
    description: 'GitHub operations with read/write access',
    tools: [
      {
        name: 'list_repositories',
        description: 'List all accessible repositories',
        inputSchema: {
          type: 'object',
          properties: {
            visibility: {
              type: 'string',
              enum: ['all', 'public', 'private'],
              description: 'Filter by visibility'
            }
          }
        }
      },
      {
        name: 'get_file',
        description: 'Get file contents from a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            path: { type: 'string', description: 'File path' },
            branch: { type: 'string', description: 'Branch name (optional)' }
          },
          required: ['owner', 'repo', 'path']
        }
      },
      {
        name: 'create_or_update_file',
        description: 'Create or update a file in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content (will be base64 encoded)' },
            message: { type: 'string', description: 'Commit message' },
            branch: { type: 'string', description: 'Branch name (optional, defaults to default branch)' }
          },
          required: ['owner', 'repo', 'path', 'content', 'message']
        }
      },
      {
        name: 'create_branch',
        description: 'Create a new branch',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            branch: { type: 'string', description: 'New branch name' },
            from_branch: { type: 'string', description: 'Source branch (optional)' }
          },
          required: ['owner', 'repo', 'branch']
        }
      },
      {
        name: 'create_pull_request',
        description: 'Create a pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description' },
            head: { type: 'string', description: 'Source branch' },
            base: { type: 'string', description: 'Target branch' }
          },
          required: ['owner', 'repo', 'title', 'head', 'base']
        }
      }
    ]
  };

  res.write(`data: ${JSON.stringify({ type: 'metadata', metadata })}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// MCP tool execution endpoint
app.post('/execute', authenticate, async (req, res) => {
  const { tool, arguments: args } = req.body;

  try {
    let result;

    switch (tool) {
      case 'list_repositories':
        const repos = await octokit.repos.listForAuthenticatedUser({
          visibility: args.visibility || 'all',
          sort: 'updated',
          per_page: 100
        });
        result = repos.data.map(r => ({
          name: r.name,
          full_name: r.full_name,
          owner: r.owner.login,
          private: r.private,
          description: r.description,
          url: r.html_url,
          default_branch: r.default_branch
        }));
        break;

      case 'get_file':
        try {
          const file = await octokit.repos.getContent({
            owner: args.owner,
            repo: args.repo,
            path: args.path,
            ref: args.branch
          });
          
          if (Array.isArray(file.data)) {
            result = { error: 'Path is a directory, not a file' };
          } else {
            result = {
              content: Buffer.from(file.data.content, 'base64').toString('utf-8'),
              sha: file.data.sha,
              size: file.data.size,
              path: file.data.path
            };
          }
        } catch (error) {
          result = { error: error.message };
        }
        break;

      case 'create_or_update_file':
        try {
          // First, try to get the file to see if it exists
          let sha;
          try {
            const existing = await octokit.repos.getContent({
              owner: args.owner,
              repo: args.repo,
              path: args.path,
              ref: args.branch
            });
            sha = existing.data.sha;
          } catch (e) {
            // File doesn't exist, that's fine
          }

          const response = await octokit.repos.createOrUpdateFileContents({
            owner: args.owner,
            repo: args.repo,
            path: args.path,
            message: args.message,
            content: Buffer.from(args.content).toString('base64'),
            branch: args.branch,
            sha: sha
          });

          result = {
            success: true,
            commit: response.data.commit.sha,
            content: response.data.content
          };
        } catch (error) {
          result = { error: error.message };
        }
        break;

      case 'create_branch':
        try {
          const repo = await octokit.repos.get({
            owner: args.owner,
            repo: args.repo
          });

          const fromBranch = args.from_branch || repo.data.default_branch;
          
          const ref = await octokit.git.getRef({
            owner: args.owner,
            repo: args.repo,
            ref: `heads/${fromBranch}`
          });

          const newBranch = await octokit.git.createRef({
            owner: args.owner,
            repo: args.repo,
            ref: `refs/heads/${args.branch}`,
            sha: ref.data.object.sha
          });

          result = {
            success: true,
            branch: args.branch,
            sha: newBranch.data.object.sha
          };
        } catch (error) {
          result = { error: error.message };
        }
        break;

      case 'create_pull_request':
        try {
          const pr = await octokit.pulls.create({
            owner: args.owner,
            repo: args.repo,
            title: args.title,
            body: args.body || '',
            head: args.head,
            base: args.base
          });

          result = {
            success: true,
            number: pr.data.number,
            url: pr.data.html_url,
            state: pr.data.state
          };
        } catch (error) {
          result = { error: error.message };
        }
        break;

      default:
        result = { error: `Unknown tool: ${tool}` };
    }

    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`GitHub MCP Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
