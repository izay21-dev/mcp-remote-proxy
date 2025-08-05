# NPM Token Setup for GitHub Actions

To enable automated publishing, you need to configure an NPM access token in your GitHub repository secrets.

## Steps to Set Up NPM Token

1. **Generate NPM Access Token**
   - Go to [npmjs.com](https://www.npmjs.com/) and log in
   - Click on your profile → Access Tokens
   - Click "Generate New Token" → "Granular Access Token"
   - Give it a name like "GitHub Actions - mcp-remote-proxy"
   - Set expiration (recommend 1 year)
   - Select permissions: "Read and write" for packages
   - Select packages: Choose your package `@izay21.dev/mcp-remote-proxy`
   - Copy the generated token

2. **Add Token to GitHub Secrets**
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste the NPM token you copied
   - Click "Add secret"

3. **Verify Setup**
   - Push to main branch or create a release
   - Check Actions tab to see if the workflow runs successfully
   - Check npmjs.com to see if your package was published

## Workflow Behavior

- **CI Workflow** (`ci.yml`): Runs on PRs and non-main branches to test code
- **Publish Workflow** (`publish.yml`): Runs on main branch pushes and releases
  - Publishes to npm registry with provenance
  - Also publishes to GitHub Packages
  - Includes security features and automated testing

## Security Features

- Uses provenance for package verification
- Secure token handling with JS-DevTools/npm-publish action
- Separate permissions for different registries
- Dry-run checks before actual publishing