# Gated Action — Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Bob as Bob (agent)
    participant MCP as inbin-gate MCP tool<br/>(run_command)
    participant Core as gate/core.mjs
    participant Decide as gate/decide.mjs

    Bob->>MCP: proposes run_command { cmd }
    MCP->>Core: gate("run_command", { cmd })
    Core->>Core: readIntent() — loads ~/.inbin-gate/intent.json<br/>(developer's out-of-band channel)
    Core->>Core: readPolicy() — loads package.json scripts<br/>and .gate/policy.json<br/>(repository maintainers' channel)
    Core->>Decide: decide(action, args, { intent, policy, untrusted })
    Decide->>Decide: mint claim on chan:developer-intent (if intent states cmd)
    Decide->>Decide: mint claim on chan:repo-policy (if policy lists cmd)
    Decide->>Decide: mint claim on chan:agent-self (always — the agent's own proposal)
    Decide->>Decide: operative() resolves highest-authority claim;<br/>chan:agent-self → class PROPOSING, never ESTABLISHING
    Decide-->>Core: { allowed, reason, operands[ class, establishedBy, derivation ] }
    Core->>Core: append entry to decisions.jsonl
    Core-->>MCP: decision result

    alt allowed == true
        MCP->>MCP: executes shell command
        MCP-->>Bob: stdout / stderr
    else allowed == false
        MCP-->>Bob: REFUSED — refusal message with source attribution
    end

    Bob-->>Dev: reports result or quotes refusal verbatim
```

The agent's own proposal always arrives on `chan:agent-self`, which the PSAP
resolver maps to authority class `PROPOSING` — a class that carries no
governing weight over any capability. Because authority is derived solely from
the *channel* a value arrived on (never from the value's content or from
anything the agent asserts about it), there is no path by which the agent's
proposal can elevate itself: it cannot claim a higher channel, and whatever it
reads from issues, READMEs, or CI logs is equally untrusted content that is
still presented on `chan:agent-self` when proposed.
