const { execSync } = require('child_process');
const fs = require('fs');

async function getBestModel(apiUrl, apiKey) {
  try {
    const modelsUrl = apiUrl.replace('/chat/completions', '/models');
    console.log(`Fetching available models from ${modelsUrl}...`);
    
    const response = await fetch(modelsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.data || !Array.isArray(data.data)) return null;
    
    // Sort models based on capabilities, prioritizing the most capable ones
    const models = data.data.map(m => m.id);
    
    // Fallback logic for OpenRouter
    if (apiUrl.includes('openrouter')) {
      if (models.includes('anthropic/claude-3.7-sonnet')) return 'anthropic/claude-3.7-sonnet';
      if (models.includes('anthropic/claude-3.5-sonnet')) return 'anthropic/claude-3.5-sonnet';
      // Find any Claude 3 model
      const anyClaude = models.find(m => m.includes('claude-3'));
      if (anyClaude) return anyClaude;
      // Fallback to GPT-4 class
      if (models.includes('openai/gpt-4o')) return 'openai/gpt-4o';
      if (models.includes('openai/gpt-4-turbo')) return 'openai/gpt-4-turbo';
    } 
    // Fallback logic for DeepSeek
    else if (apiUrl.includes('deepseek')) {
      if (models.includes('deepseek-chat')) return 'deepseek-chat';
      if (models.includes('deepseek-coder')) return 'deepseek-coder';
    }
    
    // If we can't find our preferred ones, just return the first available one
    // or return null to fall back to the hardcoded defaults
    return models[0] || null;
  } catch (error) {
    console.error('Error fetching models dynamically:', error.message);
    return null;
  }
}

async function resolveConflict(fileContent, filePath) {
  let apiKey = process.env.OPENROUTER_API_KEY;
  let apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  let model = 'anthropic/claude-3.7-sonnet';

  if (process.env.DEEPSEEK_API_KEY && !process.env.OPENROUTER_API_KEY) {
    apiKey = process.env.DEEPSEEK_API_KEY;
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    model = 'deepseek-chat'; 
  } else if (process.env.OPENCODE_ZEN_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    apiKey = process.env.OPENCODE_ZEN_API_KEY;
    apiUrl = 'https://api.zen.my/chat/completions'; 
    model = 'opencode/mimo-v2-pro-free';
  }

  if (!apiKey) {
    throw new Error('No API key found! Please set OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or OPENCODE_ZEN_API_KEY.');
  }

  // Attempt to dynamically fetch the best available model
  // Only attempt for OpenRouter and DeepSeek standard APIs
  if (apiUrl.includes('openrouter') || apiUrl.includes('deepseek')) {
    const dynamicModel = await getBestModel(apiUrl, apiKey);
    if (dynamicModel) {
      console.log(`Dynamically selected model: ${dynamicModel}`);
      model = dynamicModel;
    }
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
