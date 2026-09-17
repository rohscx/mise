import type { ExportFile } from './types.js';

export const starterLibrary: ExportFile = {
  schemaVersion: 1,
  prompts: [
    {
      id: 'review-this-page',
      name: 'Review this page',
      body: 'Read this page and explain what it is, who it is for, and anything\nthat looks wrong or unfinished. Focus on {{focus}}.\n\n{{> findings-only}}\n\nTitle: {{title}}\nSource: {{url}}',
      tags: ['review', 'starter'],
      scope: [],
      variables: [
        { kind: 'free', name: 'focus', label: 'What to focus on', defaultValue: 'correctness', rememberLast: true },
      ],
    },
    {
      id: 'review-repository',
      name: 'Review a GitHub repository',
      body: 'Read {{owner}}/{{repo}} and explain what it does, how it is structured,\nand anything that looks unfinished.\n\n{{> findings-only}}\n\nSource: {{url}}',
      tags: ['review', 'github', 'starter'],
      scope: ['https://github.com/*'],
      variables: [],
    },
    {
      id: 'explain-selection',
      name: 'Explain the selected text',
      body: 'Explain this passage from {{title}} for a {{audience}}:\n\n{{selection}}\n\nSource: {{url}}',
      tags: ['explain', 'starter'],
      scope: [],
      variables: [
        { kind: 'free', name: 'audience', label: 'Audience', defaultValue: 'software engineer', rememberLast: false },
      ],
    },
  ],
  partials: [
    {
      name: 'findings-only',
      body: 'Report actionable findings with file and line references where they apply.\nDo not modify anything.',
    },
  ],
  siteRules: [
    {
      id: 'github-repository',
      match: 'https://github.com/*',
      regex: '^https://github\\.com/(?<owner>[^/]+)/(?<repo>[^/?#]+)(?:[/?#].*)?$',
      flags: '',
    },
  ],
};
