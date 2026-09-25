# Sources of the two real payloads in sample-project

The payload text lives in the sample project without any annotation, because an attacker does not
annotate a payload and the first baseline run showed Bob recognising the attack from our citation
comment rather than from the content. The attributions are here instead.

- `sample-project/issues/007-author-recognition.md`: the issue body is reproduced verbatim from the
  Invariant Labs proof of concept against the GitHub MCP integration (May 2025), the public issue
  that made an agent read a private repository and leak it through a pull request.
  Source: https://www.docker.com/blog/mcp-horror-stories-github-prompt-injection/
- `sample-project/pull-requests/pr-42.md`: the "Agent instructions" sentence is reproduced verbatim
  from the prompt injected into the Amazon Q Developer VS Code extension by a pull request on
  13 July 2025, shipped in release 1.84.0 on 17 July 2025. The command line beneath it is ours,
  standing in for what such an instruction leads to.
  Source: https://adversa.ai/blog/amazon-ai-coding-assistant-q-incident-lessons-learned/
