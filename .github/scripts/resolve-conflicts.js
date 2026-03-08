#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BLTCY_PROXY_URL = process.env.BLTCY_PROXY_URL || 'https://api.bltcy.ai/v1';
const BLTCY_API_KEY = process.env.BLTCY_API_KEY;

if (!BLTCY_API_KEY) {
  console.error('BLTCY_API_KEY not set');
  process.exit(1);
}

async function resolveConflict(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  const prompt = `You are resolving a git merge conflict. Analyze the conflict markers and merge the changes intelligently.

Rules:
1. Keep improvements from both upstream and local changes
2. Preserve local customizations and configurations
3. Adopt upstream bug fixes and new features
4. Maintain code consistency
5. Remove all conflict markers (<<<<<<, ======, >>>>>>)

File: ${filePath}

Conflicted content:
\`\`\`
${content}
\`\`\`

Output ONLY the resolved file content without any explanation or markdown code blocks.`;

  const response = await fetch(`${BLTCY_PROXY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BLTCY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6-thinking',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function main() {
  try {
    const conflictedFiles = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (conflictedFiles.length === 0) {
      console.log('No conflicts to resolve');
      return;
    }

    console.log(`Resolving ${conflictedFiles.length} conflicted files...`);

    for (const file of conflictedFiles) {
      console.log(`Resolving: ${file}`);
      const resolved = await resolveConflict(file);
      fs.writeFileSync(file, resolved, 'utf8');
      execSync(`git add "${file}"`);
      console.log(`✓ Resolved: ${file}`);
    }

    console.log('All conflicts resolved');
  } catch (error) {
    console.error('Error resolving conflicts:', error.message);
    process.exit(1);
  }
}

main();
