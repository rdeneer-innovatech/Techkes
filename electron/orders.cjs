// Prompt: clicking Order should read all GitHub issues and create one big order.
// Reason: turn the submitted issue bodies into customer order paths without
// exposing the former hard-coded GitHub token in the renderer.
function ordersFromIssues(issues) {
  const orders = [];
  for (const issue of issues) {
    if (issue.pull_request || !issue.body) continue;
    const items = String(issue.body).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (items.length) orders.push({ customer: String(issue.title || 'Unknown customer'), items });
  }
  return orders;
}

async function fetchOpenIssues(repository, token, request = fetch) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Techkes-order-app' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const all = [];
  for (let page = 1; ; page += 1) {
    const response = await request(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GitHub could not load orders (${response.status}). Set GITHUB_TOKEN for a private repository.`);
    const issues = await response.json();
    if (!Array.isArray(issues)) throw new Error('GitHub returned an unexpected order list.');
    all.push(...issues);
    if (issues.length < 100) return ordersFromIssues(all);
  }
}

module.exports = { fetchOpenIssues, ordersFromIssues };
