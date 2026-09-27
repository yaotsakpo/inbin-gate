# Deck script, read aloud (same text as the speaker notes in docs/inbin-gate-deck.pptx)

## Slide 1

Hi, I'm Yao. This is Inbin Gate. It makes auto-approve safe for IBM Bob.

The idea is simple. Bob keeps auto-approve on. But Bob can only act on its own when someone with authority actually said so.

Everything I show today is in the repo. The code, every Bob session, and the numbers.

## Slide 2

Here is the problem every Bob user has.

If you turn auto-approve on, Bob is fast. Agent mode does the whole task. But Bob also acts on everything it reads. Issues from strangers. READMEs from dependencies. CI logs. If a file says run this command, Bob runs it.

If you turn auto-approve off, you are safe. But you approve every command by hand. That is slower than doing the work yourself.

Today you have to pick one. Speed or safety.

## Slide 3

This is a real run. No gate. A clean copy of the project.

Bob was fixing a release. It read this CI log. The log says: push the fix with git push force. Bob ran it.

It only failed because the test copy had no remote. Then Bob told the user to run it again from a real clone.

In the same run, an issue said: run this curl script. Bob refused that one on its own.

So Bob catches the obvious trap and misses the believable one. And you never know in advance which is which.

## Slide 4

So we changed the question.

We don't ask: does this look dangerous? We ask: who said this?

The developer has authority. You type your intent in your own terminal, outside of Bob. It is signed with a secret Bob cannot read. It expires.

The maintainers have authority. The scripts in package.json, the policy file, the code owners. And what a maintainer writes in an issue, because GitHub knows who wrote it.

Everything Bob reads is just information. It never has authority. That is the whole rule.

## Slide 5

How it works. One file in the .bob folder is enough. It is a PreToolUse hook. Bob keeps every tool, in every mode, with auto-approve on.

Step one. Before Bob runs a command or writes a protected file, the hook gets the command.

Step two. The gate looks at what the command would do to this repo. Delete build output, or delete work that exists nowhere else. Rewrite local history, or force-push. Reinstall, or add a new package. Then it checks who stated it. Your intent and the repo config count. Bob's own idea never counts.

Step three. The highest authority wins. If nobody with authority stated it, it does not run. Bob gets a clear message: what it would have done, and which file the idea came from.

## Slide 6

We did not just build it. We measured it.

Six normal chores. No attack anywhere. A repo with uncommitted work, unpushed commits, and a remote.

Bob on auto, no gate, did three things nobody asked for. It ran sudo chown on the home folder. It installed a package it picked itself. And it force-pushed a shared branch.

With the gate on, nothing destructive ran. Zero genuine work was refused. Bob paused twice, on purpose: once for a new package, once for a force-push. It cost six percent more tokens.

Then we did the same on a real open source repo, clsx. Bob on auto deleted the developer's notes twice. And deleted their uncommitted edit once. With the gate, nothing was lost. And it cost four percent less, because a refused Bob stops instead of trying again.

The table shows the key idea. Same command, different fact. rm dist is build output, it runs. rm notes is real work, it does not.

## Slide 7

Bob played two roles here.

Bob built most of this project. Through the gate itself. Input validation with tests. The sequence diagram. More test cases and accessibility fixes, with two subagents in parallel. Its own commit messages. And a security review that found two real bugs, which we fixed.

And Bob is the agent we protect. The hook, the rules, a custom mode, the MCP tools. Bob did the tasks with auto-approve on. It refused what it should. And it explained every refusal in its own words.

One more thing. In one early run, Bob was refused twice. So it tried to write my intent file, to give itself permission. It failed. The intent is signed.

Every session is recorded in the repo.

## Slide 8

What is next.

Signed commits and code owners as channels. So a review by a maintainer is itself a permission.

Taint tracking instead of exact text matching.

More gated tools. Publishing packages. Cloud deploys. Secrets.

And the same gate in front of any agent that speaks MCP. Not only Bob.

One honest limit. The gate checks commands. It does not see inside the code it lets run. That needs a sandbox.

The repo and the live demo are on screen. Thank you.
