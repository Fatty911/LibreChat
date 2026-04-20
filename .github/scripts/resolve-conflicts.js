const { execSync } = require('child_process');
const fs = require('fs');

async function resolveConflict(fileContent, filePath) {
  let apiKey = process.env.OPENROUTER_API_KEY;
  let apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  
  // 更新为 2025/2026 年代更先进的模型
  let model = 'anthropic/claude-3.7-sonnet';

  if (process.env.DEEPSEEK_API_KEY && !process.env.OPENROUTER_API_KEY) {
    apiKey = process.env.DEEPSEEK_API_KEY;
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    // deepseek-coder 已经过时，更新为 deepseek-chat (DeepSeek-V3) 或 deepseek-reasoner (DeepSeek-R1)
    model = 'deepseek-chat'; 
  } else if (process.env.OPENCODE_ZEN_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    apiKey = process.env.OPENCODE_ZEN_API_KEY;
    apiUrl = 'https://api.zen.my/chat/completions'; 
    model = 'opencode/mimo-v2-pro-free';
  }

  if (!apiKey) {
    throw new Error('No API key found! Please set OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or OPENCODE_ZEN_API_KEY.');
  }

  const prompt = `You are an expert developer. The following file has Git merge conflicts marked with <<<<<<<, =======, and >>>>>>>. 
Your task is to resolve the conflicts optimally. 
Analyze the changes from both HEAD (local) and upstream, understand the intent, and provide the fully resolved file content.
DO NOT include any markdown code block backticks (like \`\`\`javascript) around the output. 
ONLY output the raw resolved file content so it can be directly written to the file.

File path: ${filePath}

File content with conflicts:
${fileContent}
`;

  console.log(`Sending request to ${apiUrl} for ${filePath} using model ${model}`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  let resolvedContent = data.choices[0].message.content;
  
  // Clean up any potential markdown code blocks the LLM might still generate despite instructions
  resolvedContent = resolvedContent.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
  
  return resolvedContent;
}

async function main() {
  try {
    const status = execSync('git diff --name-only --diff-filter=U').toString();
    const files = status.split('\n').filter(Boolean);

    if (files.length === 0) {
      console.log('No files with conflicts found.');
      return;
    }

    console.log(`Found ${files.length} conflicted files:`, files);

    for (const file of files) {
      console.log(`Resolving conflict in ${file}...`);
      const content = fs.readFileSync(file, 'utf8');
      
      const resolvedContent = await resolveConflict(content, file);
      
      fs.writeFileSync(file, resolvedContent);
      console.log(`Successfully resolved and wrote ${file}`);
    }
  } catch (error) {
    console.error('Error resolving conflicts:', error);
    process.exit(1);
  }
}

main();
