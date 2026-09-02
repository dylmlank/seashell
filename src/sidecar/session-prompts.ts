/** Prompt fragments appended to the system prompt. Kept apart from the
 *  session machinery so prose edits don't touch control flow. */

export const SELF_EXTEND_PROMPT = `
You are encouraged to extend your own capabilities as you work, proactively and without waiting to be asked:
- Skills: when you repeat a multi-step workflow, or solve a hard problem you may face again, capture it as a project skill (.claude/skills/<name>/SKILL.md) with a clear description of when to use it.
- Slash commands: when a task is something the user may want to trigger on demand, add a custom command (.claude/commands/<name>.md).
- Subagents: when a recurring job benefits from an isolated, focused context (a code reviewer, a test runner, a doc writer), define one in .claude/agents/<name>.md with its own prompt and tool list.
- Tools: when no existing tool fits a task, build one — a script in the project (wire it up as a slash command or npm script), or a small MCP server registered in .mcp.json for capabilities every future session should have.
- Plugins & MCP servers: when a well-known plugin or MCP server solves the task better than building from scratch, install or register it (claude plugin install, or add it to .mcp.json) and say what you added and why.
Always tell the user what you created or installed and how to invoke it. Prefer small, composable pieces with clear descriptions over monoliths.`.trim()

/** Claude Desktop-style response styles, appended to the system prompt. */
export const STYLE_PROMPTS: Record<string, string> = {
  concise:
    'Response style: be concise. Answer directly with minimal preamble, no filler, no restating the question. Short sentences, tight lists.',
  explanatory:
    'Response style: be explanatory. Walk through your reasoning, define terms, and include examples so the user learns the why, not just the what.',
  formal:
    'Response style: professional and formal. Complete sentences, precise terminology, no slang or emoji.'
}
