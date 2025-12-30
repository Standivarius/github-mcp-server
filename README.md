# GitHub MCP Server

MCP server providing GitHub operations (read/write) for ChatGPT.

## Environment Variables

Required in Railway:
- `GITHUB_TOKEN` - Your GitHub personal access token
- `MCP_API_KEY` - (Optional) API key for securing the endpoint
- `PORT` - Automatically set by Railway (3000 locally)

## Deployment to Railway

1. Create new project in Railway
2. Connect to this GitHub repo or deploy from local files
3. Set environment variables in Railway dashboard
4. Deploy

## Local Testing

```bash
npm install
GITHUB_TOKEN=your_token_here npm start
```

## Available Tools

- `list_repositories` - List all accessible repos
- `get_file` - Read file contents
- `create_or_update_file` - Write/update files
- `create_branch` - Create new branches
- `create_pull_request` - Create PRs

## ChatGPT Configuration

After deployment, add this to ChatGPT MCP settings:

```json
{
  "github": {
    "type": "sse",
    "url": "https://your-railway-url.railway.app/sse",
    "headers": {
      "Authorization": "Bearer YOUR_MCP_API_KEY"
    }
  }
}
```
