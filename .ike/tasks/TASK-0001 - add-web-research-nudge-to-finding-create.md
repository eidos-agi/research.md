---
id: TASK-0001
title: Add web research nudge to finding_create
status: Done
created: '2026-03-29'
priority: high
tags:
  - evidence-gates
  - ux
acceptance-criteria:
  - finding_create with no sources returns advisory nudging toward web research
  - Tool description mentions web research as the expected evidence-gathering method
  - Agents that skip web research get reminded before they can upgrade to MODERATE+
updated: '2026-03-29'
---
The tool enforces rigor once sources exist but never prompts agents to actually do web research. An agent can reason its way to MODERATE without ever fetching a URL. Add an advisory when finding_create is called with no source/sources: "Consider using web search to find supporting evidence before upgrading this finding." Also consider adding a WebSearch hint in the tool description itself.
