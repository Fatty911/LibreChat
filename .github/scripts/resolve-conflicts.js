#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

async function resolveConflicts() {
  const proxyUrl = process.env.BLTCY_PROXY_URL;
  const apiKey = process.env.BLTCY_API_KEY;

  if (!proxyUrl || !apiKey) {
    console.error('Missing BLTCY_PROXY_URL or BLTCY_API_KEY');
    process.exit(1);
  }

  // Get conflicted files
  const conflictedFiles = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  if (conflictedFiles.length === 0) {
    console.log('No conflicts to resolve');
    return;
  }

  console.log(`Found ${conflictedFiles.length} conflicted files`);

  for (const file of conflictedFiles) {
    console.log(`Resolving conflicts in ${file}...`);
    
    const content = fs.readFileSync(file, 'utf-8');
    
    // Extract conflict markers
    const conflicts = extractConflicts(content);
    
    if (conflicts.length === 0) continue;

    // Call Claude API to resolve
    const resolved = await resolveWithClaude(file, content, conflicts, proxyUrl, apiKey);
    
    if (resolved) {
      fs.writeFileSync(file, resolved);
      execSync(`git add "${file}"`);
      console.log(`✓ Resolved ${file}`);
    }
  }
}

function extractConflicts(content) {
  const conflicts = [];
  const lines = content.split('\n');
  let inConflict = false;
  let current = { ours: [], theirs: [], start: -1 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('<<<<<<<')) {
      inConflict = true;
      current = { ours: [], theirs: [], start: i };
    } else if (line.startsWith('=======') && inConflict) {
      current.separator = i;
    } else if (line.startsWith('>>>>>>>') && inConflict) {
      current.end = i;
      conflicts.push(current);
      inConflict = false;
    } else if (inConflict) {
      if (current.separator === undefined) {
        current.ours.push(line);
      } else {
        current.theirs.push(line);
      }
    }
  }

  return conflicts;
}

async function resolveWithClaude(file, content, conflicts, proxyUrl, apiKey) {
  const prompt = `You are resolving git merge conflicts. Analyze the conflicts and merge the code intelligently, preserving the best parts of both versions.

File: ${file}

Full file content with conflicts:
\`\`\`
${content}
\`\`\`

Return ONLY the complete resolved file content without any explanations or markdown code blocks.`;

  try {
    const response = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-thinking',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error(`Failed to resolve ${file}:`, error.message);
    return null;
  }
}

resolveConflicts().catch(console.error);
