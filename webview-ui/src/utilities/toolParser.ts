export type ToolRequest =
  | { 
      type: "readFile"; 
      value: string; 
    }
  | { 
      type: "executeCommand"; 
      value: string; 
    }
  | { 
      type: "requestDiff"; 
      value: { path: string; content: string };
    };

export const parseTools = (content: string): ToolRequest[] => {
  const requests: ToolRequest[] = [];

  // 1. Detect <read_file path="..." />
  const readRegex = /<read_file\s+path="([^"]+)"\s*\/>/g;
  let readMatch;
  while ((readMatch = readRegex.exec(content)) !== null) {
    requests.push({ type: "readFile", value: readMatch[1] });
  }

  // 2. Detect <write_file path="...">content</write_file>
  // [\s\S]*? matches any character (including newlines) non-greedily
  const writeRegex = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  let writeMatch;
  while ((writeMatch = writeRegex.exec(content)) !== null) {
    requests.push({
      type: "requestDiff",
      value: {
        path: writeMatch[1],
        content: writeMatch[2].trim()
      }
    });
  }

  // 3. Detect <execute_command>command</execute_command>
  const cmdRegex = /<execute_command>([\s\S]*?)<\/execute_command>/g;
  let cmdMatch;
  while ((cmdMatch = cmdRegex.exec(content)) !== null) {
    requests.push({
      type: "executeCommand",
      value: cmdMatch[1].trim()
    });
  }

  return requests;
};