#!/usr/bin/env node

const { execSync } = require('child_process');

const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const LABEL = '\u{1F6A8} Sync Fail';
const TITLE = '\u{1F6A8} 上游同步失败 | Upstream Sync Failed';

function exec(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch {
        return '';
    }
}

async function createIssue() {
    if (!REPO || !TOKEN) {
        console.error('Missing REPO or GH_TOKEN environment variable');
        process.exit(1);
    }

    const conflictedFiles = exec('git diff --name-only --diff-filter=U 2>/dev/null || echo ""');
    const lastCommitMsg = exec('git log -1 --pretty=%B 2>/dev/null || echo "N/A"');
    const upstreamLog = exec('git log --oneline HEAD..upstream/main -5 2>/dev/null || echo ""');

    const conflictSection = conflictedFiles
        ? `### 冲突文件 (Conflicted Files)\n\`\`\`\n${conflictedFiles}\n\`\`\``
        : '### 冲突文件\n无冲突文件记录（可能是工作流执行错误）。';

    const upstreamSection = upstreamLog
        ? `### 上游最新提交 (Upstream Commits)\n\`\`\`\n${upstreamLog}\n\`\`\``
        : '';

    const body = `## \u{1F6A8} 上游同步失败

自动同步上游工作流未能成功完成，多 Provider AI 冲突解决也未能在本次运行中修复所有问题。

### 最近提交 (Latest Commit)
\`\`\`
${lastCommitMsg}
\`\`\`

${conflictSection}

${upstreamSection}

---

**建议操作：**
1. 手动运行 \`git fetch upstream && git merge upstream/main\` 查看冲突详情
2. 解决冲突后推送到 main 分支
3. 关闭此 Issue

**Suggested Actions:**
1. Manually run \`git fetch upstream && git merge upstream/main\` to inspect conflicts
2. Resolve conflicts and push to main
3. Close this issue

> 此 Issue 由 \`sync-upstream.yml\` 工作流自动生成。`;

    const apiUrl = `https://api.github.com/repos/${REPO}/issues`;

    try {
        const existingRes = await fetch(`${apiUrl}?state=open&labels=${encodeURIComponent(LABEL)}`, {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (existingRes.ok) {
            const issues = await existingRes.json();
            if (Array.isArray(issues) && issues.length > 0) {
                console.log(`Open sync-fail issue already exists: ${issues[0].html_url}`);
                console.log('Skipping duplicate issue creation.');
                return;
            }
        }
    } catch (e) {
        console.log(`Failed to check existing issues: ${e.message}`);
    }

    try {
        const createRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: TITLE, body, labels: [LABEL] })
        });

        if (!createRes.ok) {
            const err = await createRes.text();
            if (createRes.status === 410) {
                console.log('Issues are disabled in this repository. Skipping issue creation.');
                return;
            }
            throw new Error(`GitHub API ${createRes.status}: ${err}`);
        }

        const data = await createRes.json();
        console.log(`Created sync-fail issue: ${data.html_url}`);
    } catch (e) {
        console.error(`Failed to create issue: ${e.message}`);
        process.exit(1);
    }
}

createIssue().catch((err) => {
    console.error(err);
    process.exit(1);
});
