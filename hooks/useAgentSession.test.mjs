import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");

test("keeps the session event stream open through the idle grace window", () => {
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(agentSettledSource, /onAgentEnd\?\.\(\)/);
  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /const definitivelyRejected = !promptRequestStarted/);
  assert.match(sendSource, /if \(!definitivelyRejected && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /restoreSubmission\(message, images, composerDraftKey\);[\s\S]*?if \(sentSessionId\) \{[\s\S]*?reconcileAgentState\(sentSessionId\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
  assert.doesNotMatch(
    sendSource,
    /rpcPromptPendingRef\.current = false;\s*agentRunningRef\.current = false;\s*closeEvents\(\)/,
  );
});

test("a rejected submission preserves a different run reported by the server", () => {
  const reconcileSource = source.slice(
    source.indexOf("  const reconcileAgentState = useCallback"),
    source.indexOf("  // Recovery net for missed SSE events"),
  );

  assert.match(reconcileSource, /sessionIdRef\.current !== sid/);
  assert.match(reconcileSource, /if \(busy\) \{[\s\S]*?sdkAgentActiveRef\.current = Boolean\(state\.isStreaming\)/);
  assert.match(reconcileSource, /rpcPromptPendingRef\.current = Boolean\(state\.isPromptRunning\)/);
  assert.match(reconcileSource, /if \(!agentRunningRef\.current\) return;[\s\S]*?finishPromptWithoutStream/);
});

test("opening System lazily starts a dormant session without sending a prompt", () => {
  const loadSystemPromptSource = source.slice(
    source.indexOf("  const loadSystemPrompt = useCallback"),
    source.indexOf("  const loadSlashCommands = useCallback"),
  );
  const loaderEffectSource = source.slice(
    source.indexOf("  useEffect(() => {\n    onSystemPromptLoaderChange"),
    source.indexOf("  useEffect(() => {\n    if (!onBranchDataChange) return;"),
  );

  assert.match(loadSystemPromptSource, /sessionIdRef\.current \?\? await ensureNewSession\(\)/);
  assert.doesNotMatch(loadSystemPromptSource, /promoteNewSession\(\)/);
  assert.match(loadSystemPromptSource, /sendAgentCommand<AgentStateResponse>\(sid, \{ type: "get_state" \}\)/);
  assert.doesNotMatch(loadSystemPromptSource, /type: "prompt"/);
  assert.match(loadSystemPromptSource, /setSystemPrompt\(state\.systemPrompt \?\? ""\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(loadSystemPrompt\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(null\)/);
  assert.match(appShellSource, /onClick=\{\(\) => handleSystemPromptToggle\(mobile\)\}/);
  assert.match(appShellSource, /systemPromptLoaderRef\.current/);
  assert.doesNotMatch(appShellSource, /systemPrompt !== null \|\| systemPromptLoading/);
  assert.match(appShellSource, /const loadId = \+\+systemPromptLoadIdRef\.current/);
  assert.match(appShellSource, /systemPromptLoadIdRef\.current === loadId/);
  assert.match(
    appShellSource,
    /handleSystemPromptLoaderChange[\s\S]*?systemPromptLoadIdRef\.current \+= 1;[\s\S]*?setSystemPromptLoading\(false\)/,
  );
});

test("new-session promotion rekeys drafts before publishing the real session", () => {
  const promoteSource = source.slice(
    source.indexOf("  const promoteNewSession = useCallback"),
    source.indexOf("  const ensureNewSession = useCallback"),
  );

  assert.match(promoteSource, /draftKeyAliasesRef\.current\.set\(provisionalDraftKey, sid\)/);
  assert.match(promoteSource, /input\.rekeyDraft\(provisionalDraftKey, sid\)/);
  assert.ok(
    promoteSource.indexOf("input.rekeyDraft(provisionalDraftKey, sid)")
      < promoteSource.indexOf("onSessionCreated?.({"),
  );
  assert.match(promoteSource, /}, provisionalDraftKey\)/);
  assert.match(chatWindowSource, /draftKey=\{session\?\.id \?\? newSessionDraftKey \?\? undefined\}/);
});

test("fresh sessions restore the preferred tool preset without overriding existing sessions", () => {
  const preferenceSource = source.slice(
    source.indexOf("  const setToolPresetState"),
    source.indexOf("  const scrollToBottom"),
  );
  const loadToolsSource = source.slice(
    source.indexOf("  const loadTools = useCallback"),
    source.indexOf("  const promoteNewSession"),
  );
  const changeSource = source.slice(
    source.indexOf("  const handleToolPresetChange = useCallback"),
    source.indexOf("  const scrollUserMsgToTop"),
  );

  assert.match(
    preferenceSource,
    /useLayoutEffect\(\(\) => \{\s*if \(!isNew \|\| sessionIdRef\.current\) return;\s*setToolPresetState\(getPreferredToolPreset\(\)\)/,
  );
  assert.match(changeSource, /setPreferredToolPreset\(preset\)/);
  assert.match(changeSource, /sendAgentCommand\(sid, \{ type: "set_tools", toolNames \}\)/);
  assert.doesNotMatch(loadToolsSource, /setPreferredToolPreset/);
});

test("submission recovery updates live refs before a possible session rekey", () => {
  const restoreMethod = chatInputSource.slice(
    chatInputSource.indexOf("    restoreSubmission(text:"),
    chatInputSource.indexOf("    insertText(text:"),
  );

  assert.ok(
    restoreMethod.indexOf("valueRef.current = restoredDraft.value")
      < restoreMethod.indexOf("setValue((current) =>"),
  );
  assert.ok(
    restoreMethod.indexOf("attachedImagesRef.current = restoredImages")
      < restoreMethod.indexOf("setAttachedImages((current) =>"),
  );
});

test("stale fresh-session completion cannot replace the active composer", () => {
  const cwdChangeSource = appShellSource.slice(
    appShellSource.indexOf("  const handleCwdChange = useCallback"),
    appShellSource.indexOf("  const handleSelectSession = useCallback"),
  );
  const newSessionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleNewSession = useCallback"),
    appShellSource.indexOf("  // Global keyboard shortcuts"),
  );
  const createdSource = appShellSource.slice(
    appShellSource.indexOf("  const handleSessionCreated = useCallback"),
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
  );

  assert.match(newSessionSource, /const draftKey = `new:\$\{sessionId\}:\$\{cwd\}`/);
  assert.match(newSessionSource, /activeNewSessionDraftKeyRef\.current = draftKey/);
  assert.match(createdSource, /activeNewSessionDraftKeyRef\.current !== sourceDraftKey/);
  assert.match(cwdChangeSource, /const currentFreshCwd = newSessionCwd \?\? activeCwd/);
  assert.match(
    cwdChangeSource,
    /currentProject === newProject\s*&& \(selectedSession !== null \|\| currentFreshCwd === cwd\)/,
  );
  assert.match(cwdChangeSource, /if \(currentProject !== newProject\) \{[\s\S]*?setFileTabs\(\[\]\)/);
  assert.match(
    appShellSource,
    /useLayoutEffect\(\(\) => \{\s*activeNewSessionDraftKeyRef\.current = newSessionDraftKey;/,
  );
  assert.ok(
    createdSource.indexOf("activeNewSessionDraftKeyRef.current !== sourceDraftKey")
      < createdSource.indexOf("setSelectedSession(session)"),
  );
});

test("abandoned fresh-session drafts are cleared and cannot be recreated by late rejection", () => {
  const restoreSource = source.slice(
    source.indexOf("  const restoreSubmission = useCallback"),
    source.indexOf("  const sessionStats = useMemo"),
  );
  const mountSource = source.slice(
    source.indexOf("  // Load session on mount"),
    source.indexOf("  useEffect(() => {\n    onSystemPromptChange"),
  );

  assert.match(restoreSource, /!sessionHookMountedRef\.current[\s\S]*?!newSessionPromotedRef\.current/);
  assert.match(mountSource, /const abandonedDraftKey = isNew \? newSessionDraftKey : null/);
  assert.match(mountSource, /clearDraft\(abandonedDraftKey\)/);
});

test("streaming submissions cannot be stranded in an idle direct queue", () => {
  const queueSource = source.slice(
    source.indexOf("  // Let AgentSession.prompt decide atomically"),
    source.indexOf("  const handleAbortCompaction"),
  );

  assert.match(queueSource, /type: "prompt"/);
  assert.match(queueSource, /streamingBehavior: behavior/);
  assert.match(queueSource, /if \(isPromptRejectedError\(e\)\) restore\(\)/);
  assert.doesNotMatch(queueSource, /type: "steer"/);
  assert.doesNotMatch(queueSource, /type: "follow_up"/);
});

test("post-accept prompt errors do not duplicate the user submission", () => {
  const promptErrorSource = source.slice(
    source.indexOf('case "prompt_error"'),
    source.indexOf('case "extension_error"'),
  );

  assert.match(promptErrorSource, /addNotice/);
  assert.doesNotMatch(promptErrorSource, /restoreSubmission/);
});

test("delegates event stream readiness and hides an empty agent phase", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(source, /new AgentEventConnection\(\{/);
  assert.match(source, /shouldMaintain: \(sid\)[\s\S]*?sessionIdRef\.current === sid/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.ensureConnected\(sid\)/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.maintain\(sid\)/);
  assert.match(chatWindowSource, /const hasStreamingContent = Boolean\(streamState\.streamingMessage\?\.content\.length\)/);
  assert.match(chatWindowSource, /streamState\.isStreaming && hasStreamingContent && streamState\.streamingMessage/);
  assert.match(chatWindowSource, /agentRunning && !hasStreamingContent && agentPhase/);
  assert.match(chatWindowSource, /return null;/);
});

test("uses one absolute agent-readiness deadline instead of a five-second transport deadline", () => {
  assert.match(source, /EVENT_STREAM_READY_TIMEOUT_MS = 60_000/);
  assert.doesNotMatch(source, /EVENT_STREAM_OPEN_TIMEOUT_MS/);
});

test("connects a selected session when another browser reports it running", () => {
  assert.match(source, /sessionRunning\?: boolean/);
  assert.match(
    source,
    /if \(!session\?\.id \|\| !sessionRunning\) return;[\s\S]*?maintainEventsConnected\(session\.id\)/,
  );
  assert.match(source, /maintainEventsConnected\(session\.id\)/);
  assert.doesNotMatch(source, /void connectEvents\(/);
  assert.match(chatWindowSource, /sessionRunning\?: boolean/);
  assert.match(chatWindowSource, /session, sessionRunning, newSessionCwd/);
  assert.match(appShellSource, /runningSessionIds\.has\(selectedSession\.id\)/);
  assert.match(appShellSource, /onRunningSessionIdsChange=\{handleRunningSessionIdsChange\}/);
});

test("keeps one reducer-owned assistant partial and consumes Pi JSON deltas", () => {
  const connectedSource = source.slice(
    source.indexOf('case "connected"'),
    source.indexOf('case "agent_start"'),
  );
  const streamSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );

  assert.match(source, /streamReducer,[\s\S]*type ClientAssistantMessageEvent/);
  assert.doesNotMatch(source, /streamingMessageRef/);
  assert.match(connectedSource, /dispatch\(\{ type: "end" \}\)/);
  assert.match(connectedSource, /event\.isStreaming === true/);
  assert.match(connectedSource, /agentRunningRef\.current = true/);
  assert.match(streamSource, /msg\?\.role === "assistant"[\s\S]*dispatch\(\{ type: "snapshot", message: msg \}\)/);
  assert.match(streamSource, /event\.assistantMessageEvent as ClientAssistantMessageEvent/);
  assert.match(streamSource, /dispatch\(\{ type: "delta", event: delta \}\)/);
  assert.match(streamSource, /delta\.type !== "toolcall_start" && delta\.type !== "toolcall_delta"/);
  assert.doesNotMatch(streamSource, /case "message_delta"/);
  assert.match(messageEndSource, /const completed = event\.message as AgentMessage/);
  assert.match(messageEndSource, /normalizeToolCalls\(completed\)/);
  assert.match(messageEndSource, /dispatch\(\{ type: "end" \}\)/);
  assert.doesNotMatch(messageEndSource, /streamState\.streamingMessage/);
});

test("reconciles completed custom messages that arrive after the prompt settles", () => {
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );

  assert.match(messageEndSource, /if \(!agentRunningRef\.current\) \{\s*if \(completed\?\.role !== "custom"\) break/);
  assert.match(messageEndSource, /loadSession\(sid, false, false, \(\) =>/);
  assert.match(messageEndSource, /promptRunIdRef\.current === promptRunId/);
  assert.match(messageEndSource, /&& !agentRunningRef\.current/);

  const idleCustomSource = messageEndSource.slice(
    messageEndSource.indexOf("if (!agentRunningRef.current)"),
    messageEndSource.indexOf('if (completed && completed.role === "user")'),
  );
  assert.doesNotMatch(idleCustomSource, /dispatch\(\{ type: "(?:start|snapshot)"/);
  assert.doesNotMatch(idleCustomSource, /setAgentRunning\(true\)|setAgentPhase/);
});

test("treats artifact progress entries and terminal custom messages as phase-neutral upserts", () => {
  const streamSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "tool_execution_start"'),
  );
  const entrySource = source.slice(
    source.indexOf('case "entry_appended"'),
    source.indexOf('case "tool_execution_start"'),
  );

  assert.match(streamSource, /if \(msg && isArtifactBundleMessage\(msg\)\) break/);
  assert.match(streamSource, /if \(completed && isArtifactBundleMessage\(completed\)\)[\s\S]*?upsertArtifactBundleMessage\(prev, completed\)[\s\S]*?break/);
  assert.match(entrySource, /artifactProgressEntryToMessage\(event\.entry as SessionEntry\)/);
  assert.match(entrySource, /upsertArtifactBundleMessage\(prev, progressMessage\)/);
  assert.doesNotMatch(entrySource, /dispatch\(|setAgentPhase/);
});

test("applies only the latest session context and tracks state reloads independently", () => {
  const loadSessionSource = source.slice(
    source.indexOf("  const loadSession = useCallback"),
    source.indexOf("  const loadContext = useCallback"),
  );
  const loadContextSource = source.slice(
    source.indexOf("  const loadContext = useCallback"),
    source.indexOf("  const loadTools = useCallback"),
  );

  assert.match(loadSessionSource, /const contextGeneration = \+\+sessionContextLoadGenerationRef\.current/);
  assert.match(loadSessionSource, /const loadingGeneration = showLoading \? \+\+sessionLoadingGenerationRef\.current : null/);
  assert.match(loadSessionSource, /const stateGeneration = includeState \? \+\+sessionStateLoadGenerationRef\.current : null/);
  assert.match(loadSessionSource, /sessionContextLoadGenerationRef\.current === contextGeneration/);
  assert.match(loadSessionSource, /sessionStateLoadGenerationRef\.current === stateGeneration/);
  assert.match(loadSessionSource, /if \(canApplyContext\(\)\) \{/);
  assert.match(loadSessionSource, /if \(!canApplyState\(\)\) return null/);
  assert.match(loadSessionSource, /if \(!messagesLoaded && \(canApplyContext\(\) \|\| canSettleLoading\(\)\)\) setLoading\(false\)/);
  assert.match(loadContextSource, /const contextGeneration = \+\+sessionContextLoadGenerationRef\.current/);
  assert.match(loadContextSource, /const loadingGeneration = \+\+sessionLoadingGenerationRef\.current/);
  assert.match(loadContextSource, /sessionHookMountedRef\.current[\s\S]*?sessionIdRef\.current === sid[\s\S]*?sessionContextLoadGenerationRef\.current === contextGeneration/);
  assert.match(loadContextSource, /if \(!canApplyContext\(\)\) return[\s\S]*?setLoading\(false\)/);
});

test("invalidates pending context reloads before direct client message writes", () => {
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );
  const handleSendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.ok(messageEndSource.indexOf("invalidatePendingContextLoads()") < messageEndSource.indexOf("setMessages((prev) =>"));
  assert.ok(handleSendSource.indexOf("invalidatePendingContextLoads()") < handleSendSource.indexOf("setMessages((prev) => [...prev, userMsg])"));
});

test("owns loading and tool discovery independently from broader state updates", () => {
  const invalidationSource = source.slice(
    source.indexOf("  const invalidatePendingContextLoads = useCallback"),
    source.indexOf("  useLayoutEffect(() =>"),
  );
  const loadToolsSource = source.slice(
    source.indexOf("  const loadTools = useCallback"),
    source.indexOf("  const promoteNewSession"),
  );
  const toolChangeSource = source.slice(
    source.indexOf("  const handleToolPresetChange = useCallback"),
    source.indexOf("  const scrollUserMsgToTop"),
  );

  assert.match(invalidationSource, /sessionContextLoadGenerationRef\.current \+= 1[\s\S]*?sessionLoadingGenerationRef\.current \+= 1[\s\S]*?setLoading\(false\)/);
  assert.match(loadToolsSource, /const generation = \+\+toolsLoadGenerationRef\.current/);
  assert.match(loadToolsSource, /sessionHookMountedRef\.current[\s\S]*?sessionIdRef\.current === sid[\s\S]*?toolsLoadGenerationRef\.current === generation/);
  assert.match(loadToolsSource, /if \(!tools \|\| !canApplyTools\(\)\) return[\s\S]*?await import[\s\S]*?if \(!canApplyTools\(\)\) return[\s\S]*?setToolPresetState/);
  assert.ok(toolChangeSource.indexOf("toolsLoadGenerationRef.current += 1") < toolChangeSource.indexOf("setToolPresetState(preset)"));
});

test("shares latest-wins state arbitration across agent-end and reconciliation fetches", () => {
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const reconcileSource = source.slice(
    source.indexOf("  const reconcileAgentState = useCallback"),
    source.indexOf("  // Recovery net for missed SSE events"),
  );

  assert.match(agentEndSource, /const sid = sessionIdRef\.current/);
  assert.match(agentEndSource, /const runId = promptRunIdRef\.current/);
  assert.match(agentEndSource, /const stateGeneration = \+\+sessionStateLoadGenerationRef\.current/);
  assert.match(agentEndSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(agentEndSource, /sessionIdRef\.current !== sid[\s\S]*?promptRunIdRef\.current !== runId[\s\S]*?sessionStateLoadGenerationRef\.current !== stateGeneration/);
  assert.match(reconcileSource, /const stateGeneration = \+\+sessionStateLoadGenerationRef\.current/);
  assert.match(reconcileSource, /sessionIdRef\.current !== sid[\s\S]*?promptRunIdRef\.current !== runId[\s\S]*?sessionStateLoadGenerationRef\.current !== stateGeneration/);
});

test("invalidates stale state snapshots for SSE and optimistic state writes", () => {
  const extensionUiSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const queueSource = source.slice(
    source.indexOf('case "queue_update"'),
    source.indexOf('case "extension_ui_request"'),
  );
  const thinkingSource = source.slice(
    source.indexOf("  const handleThinkingLevelChange = useCallback"),
    source.indexOf("  const handleToolPresetChange = useCallback"),
  );
  const compactSource = source.slice(
    source.indexOf("  const handleCompact = useCallback"),
    source.indexOf("  const loadModels = useCallback"),
  );

  assert.match(extensionUiSource, /case "setStatus":[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1[\s\S]*?case "setWidget":[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1/);
  assert.match(agentStartSource, /agentStageGenerationRef\.current \+= 1[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1/);
  assert.match(queueSource, /case "queue_update":[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1[\s\S]*?case "compaction_start":[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1/);
  assert.match(thinkingSource, /invalidatePendingContextLoads\(\)[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1[\s\S]*?setThinkingLevel\(level\)/);
  assert.match(compactSource, /compactionUiGenerationRef\.current \+= 1[\s\S]*?setIsCompacting\(true\)[\s\S]*?sessionIdRef\.current === sid[\s\S]*?compactionUiGenerationRef\.current === completionUiGeneration[\s\S]*?setIsCompacting\(false\)/);
});

test("guards mount restoration and prompt settlement with session and stage epochs", () => {
  const finishSource = source.slice(
    source.indexOf("  const finishPromptWithoutStream = useCallback"),
    source.indexOf("  const waitForPromptSettlement = useCallback"),
  );
  const mountSource = source.slice(
    source.indexOf("  // Load session on mount"),
    source.indexOf("  useEffect(() => {\n    onSystemPromptChange"),
  );

  assert.match(finishSource, /const stageGeneration = agentStageGenerationRef\.current/);
  assert.match(finishSource, /sessionHookMountedRef\.current[\s\S]*?sessionIdRef\.current === sid[\s\S]*?promptRunIdRef\.current === runId[\s\S]*?agentStageGenerationRef\.current === stageGeneration/);
  assert.doesNotMatch(finishSource, /sessionStateLoadGenerationRef\.current === stateGeneration/);
  assert.match(mountSource, /const sid = session\.id[\s\S]*?const stateGeneration = sessionStateLoadGenerationRef\.current \+ 1/);
  assert.match(mountSource, /!sessionHookMountedRef\.current[\s\S]*?sessionIdRef\.current !== sid[\s\S]*?sessionStateLoadGenerationRef\.current !== stateGeneration/);
  assert.match(mountSource, /sessionHookMountedRef\.current = false[\s\S]*?sessionContextLoadGenerationRef\.current \+= 1[\s\S]*?sessionLoadingGenerationRef\.current \+= 1[\s\S]*?sessionStateLoadGenerationRef\.current \+= 1[\s\S]*?toolsLoadGenerationRef\.current \+= 1[\s\S]*?agentStageGenerationRef\.current \+= 1/);
});

test("keeps settlement polling alive across newer state snapshots", () => {
  const waitSource = source.slice(
    source.indexOf("  const waitForPromptSettlement = useCallback"),
    source.indexOf("  const waitForBashSettlement = useCallback"),
  );

  assert.match(waitSource, /if \(sessionStateLoadGenerationRef\.current !== stateGeneration\) \{\s*await delay\(PROMPT_SETTLE_POLL_MS\);\s*continue;\s*\}/);
  assert.match(waitSource, /let stageGeneration = agentStageGenerationRef\.current/);
  assert.match(waitSource, /agentStageGenerationRef\.current !== stageGeneration[\s\S]*?stageGeneration = agentStageGenerationRef\.current[\s\S]*?continue/);
  assert.doesNotMatch(waitSource, /sessionStateLoadGenerationRef\.current !== stateGeneration\s*\) return/);
});

test("arbitrates queue recall and compact completion with operation epochs", () => {
  const recallSource = source.slice(
    source.indexOf("  const handleRecallQueue = useCallback"),
    source.indexOf("  const handleThinkingLevelChange = useCallback"),
  );
  const compactSource = source.slice(
    source.indexOf("  const handleCompact = useCallback"),
    source.indexOf("  const loadModels = useCallback"),
  );
  const builtinSource = source.slice(
    source.indexOf("  const handleBuiltinSlashCommand = useCallback"),
    source.indexOf("  // Let AgentSession.prompt decide atomically"),
  );
  const abortSource = source.slice(
    source.indexOf("  const handleAbortCompaction = useCallback"),
    source.indexOf("  const handleRecallQueue = useCallback"),
  );

  assert.match(recallSource, /const operationGeneration = \+\+sessionStateLoadGenerationRef\.current/);
  assert.match(recallSource, /sessionStateLoadGenerationRef\.current === operationGeneration[\s\S]*?setQueuedMessages\(\{ steering: \[\], followUp: \[\] \}\)/);
  assert.match(compactSource, /const operationGeneration = \+\+compactOperationGenerationRef\.current/);
  assert.match(compactSource, /let completionUiGeneration: number \| null = null/);
  assert.match(compactSource, /loadSession\(sid, true, true/);
  assert.match(compactSource, /compactOperationGenerationRef\.current === operationGeneration[\s\S]*?compactionUiGenerationRef\.current === completionUiGeneration[\s\S]*?setIsCompacting\(false\)/);
  assert.match(builtinSource, /const canApplyCompactOperation = \(\) => \([\s\S]*?sessionIdRef\.current === sid[\s\S]*?compactOperationGenerationRef\.current === compactOperationGeneration/);
  assert.match(builtinSource, /sendAgentCommand<CompactCommandResult>[\s\S]*?if \(!canApplyCompactOperation\(\)\) return \{ handled: true \}[\s\S]*?loadSession\(sid, true, true, canApplyCompactOperation\)[\s\S]*?if \(!canApplyCompactOperation\(\)\) return \{ handled: true \}/);
  assert.match(builtinSource, /catch \(e\) \{[\s\S]*?commandName === "compact"[\s\S]*?!canApplyCompactOperation\(\)[\s\S]*?return \{ handled: true \}/);
  assert.match(abortSource, /const operationGeneration = \+\+compactOperationGenerationRef\.current[\s\S]*?setIsCompacting\(false\)[\s\S]*?fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)[\s\S]*?setIsCompacting\(compacting\)/);
});

test("shows the latest streamed tool execution progress in the running phase", () => {
  const updateSource = source.slice(
    source.indexOf('case "tool_execution_update"'),
    source.indexOf('case "tool_execution_end"'),
  );

  assert.match(updateSource, /getToolExecutionProgress\(event\.partialResult\)/);
  assert.match(updateSource, /tools: \[\.\.\.tools\.filter\([\s\S]*?, updated\]/);
  assert.match(chatWindowSource, /if \(latest\?\.progress\)/);
  assert.match(chatWindowSource, /chat\.runningNamedTool[\s\S]*latest\.progress/);
});

test("plays the enabled sound once for each extension dialog", () => {
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    chatWindowSource,
    /soundedExtensionDialogIdRef\.current === extensionDialog\.id/,
  );
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  assert.match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const attentionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
    appShellSource.indexOf("  const handleAutoName = useCallback"),
  );

  assert.match(
    extensionRequestSource,
    /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/,
  );
  assert.match(chatWindowSource, /onAttentionNeeded, onSessionCreated/);
  assert.match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  assert.doesNotMatch(completionSource, /document\.visibilityState === "visible"/);
  assert.match(attentionSource, /shouldShowBrowserNotification\(\)/);
  assert.match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  assert.match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  assert.match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});

test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const scrollHandlerSource = source.slice(
    source.indexOf("const handleScrollPositionChange"),
    source.indexOf("// Load session on mount"),
  );
  const scrollToBottomSource = source.slice(
    source.indexOf("const scrollToBottom"),
    source.indexOf("const currentModel"),
  );

  assert.match(source, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  assert.match(source, /const previousScrollTopRef = useRef\(0\)/);
  assert.match(source, /const wasAttached = isNearBottomRef\.current;[\s\S]*?const isAttached = getLiveFollowAttached\([\s\S]*?wasAttached,[\s\S]*?previousScrollTopRef\.current,[\s\S]*?scrollTop,[\s\S]*?clientHeight,[\s\S]*?scrollHeight/);
  assert.match(scrollHandlerSource, /const isAgentRunning = agentRunningRef\.current;[\s\S]*?isAgentRunning\s*\? CHAT_SCROLL_REATTACH_TOLERANCE\s*:\s*CHAT_SCROLL_TAIL_TOLERANCE/);
  assert.match(source, /previousScrollTopRef\.current = scrollTop/);
  assert.match(scrollToBottomSource, /messagesEndRef\.current\?\.scrollIntoView\(\{ behavior \}\);\s*if \(container\) previousScrollTopRef\.current = container\.scrollTop/);
  assert.match(streamUpdateSource, /liveFollowFrameRef\.current === null/);
  assert.match(streamUpdateSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null;[\s\S]*?if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /!wasAttached && isAttached && isAgentRunning[\s\S]*?scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(source, /previousScrollTopRef\.current = container\.scrollTop;\s*container\.addEventListener\("scroll", handleScrollPositionChange/);
  assert.doesNotMatch(source, /SCROLL_BOTTOM_THRESHOLD|completionScrollAllowedRef|ignoreProgrammaticScrollUntilRef/);
});

test("keeps a newly sent user message at the top while its response starts", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const userScrollSource = source.slice(
    source.indexOf("const scrollUserMsgToTop"),
    source.indexOf("const handleScrollPositionChange"),
  );
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load model list"),
  );

  assert.match(streamUpdateSource, /!pendingScrollToUserRef\.current && isNearBottomRef\.current/);
  assert.match(source, /const \[promptAnchorActive, setPromptAnchorActive\] = useState\(false\)/);
  assert.match(source, /pendingScrollToUserRef\.current = true;\s*setPromptAnchorActive\(true\)/);
  assert.match(userScrollSource, /const targetTop = Math\.min\(Math\.max\(0, elAbsTop - 16\), maxScrollTop\)/);
  assert.match(userScrollSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(userScrollSource, /isNearBottomRef\.current = true/);
  assert.match(userScrollSource, /previousScrollTopRef\.current = targetTop/);
  assert.match(userScrollSource, /container\.scrollTo\(\{ top: targetTop, behavior: "auto" \}\)/);
  assert.match(scrollEffectSource, /pendingScrollToUserRef\.current = false;[\s\S]*?scrollUserMsgToTop\(\)/);
  assert.match(chatWindowSource, /const contentEnd = spacer\.getBoundingClientRect\(\)\.top[\s\S]*?getPromptAnchorSpacerHeight\([\s\S]*?targetTop,[\s\S]*?contentEnd,[\s\S]*?container\.clientHeight/);
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>/);
  assert.match(chatWindowSource, /const promptAnchorAdjustmentDoneRef = useRef\(false\)/);
  assert.match(chatWindowSource, /promptAnchorAdjustmentDoneRef\.current = false/);
  assert.match(chatWindowSource, /const isInitialMeasurement = !promptAnchorAdjustmentDoneRef\.current;[\s\S]*?promptAnchorAdjustmentDoneRef\.current = true;[\s\S]*?if \(needsInitialAdjustment\) scrollUserMsgToTop\(\)/);
});

test("keeps prompt anchor measurement outside the React update cycle", () => {
  const anchorEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    const spacer = promptAnchorSpacerRef.current;",
  );
  assert.notEqual(anchorEffectStart, -1);
  const syncEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    promptAnchorUpdateRef.current?.();",
    anchorEffectStart,
  );
  assert.notEqual(syncEffectStart, -1);
  const anchorLifecycleEffectSource = chatWindowSource.slice(
    anchorEffectStart,
    syncEffectStart,
  );
  const anchorSyncEffectSource = chatWindowSource.slice(
    syncEffectStart,
    chatWindowSource.indexOf("const availableThinkingLevels"),
  );

  assert.doesNotMatch(anchorLifecycleEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(anchorSyncEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(chatWindowSource, /setPromptAnchorSpacer|useState[^\n]*promptAnchorSpacer/);
  assert.doesNotMatch(anchorLifecycleEffectSource, /streamState\.streamingMessage/);
  assert.match(anchorLifecycleEffectSource, /spacer\.style\.height = nextPromptAnchorSpacerHeight > 0/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorUpdateRef\.current = updatePromptAnchorSpacer/);
  assert.match(anchorLifecycleEffectSource, /new ResizeObserver\(schedulePromptAnchorMeasure\)/);
  assert.match(anchorLifecycleEffectSource, /observer\?\.observe\(messageContent\)/);
  assert.match(anchorLifecycleEffectSource, /if \(disposed \|\| promptAnchorMeasureFrameRef\.current !== null\) return/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorMeasureFrameRef\.current = requestAnimationFrame\(\(\) => \{\s*promptAnchorMeasureFrameRef\.current = null;\s*updatePromptAnchorSpacer\(\)/);
  assert.match(anchorLifecycleEffectSource, /disposed = true;[\s\S]*?promptAnchorUpdateRef\.current === updatePromptAnchorSpacer[\s\S]*?cancelAnimationFrame\(promptAnchorMeasureFrameRef\.current\)/);
  assert.match(anchorSyncEffectSource, /promptAnchorUpdateRef\.current\?\.\(\);\s*\}, \[streamState\.streamingMessage\]\)/);
  assert.match(chatWindowSource, /<div ref=\{messageContentRef\} style=\{\{/);
});

test("uses the prompt anchor as the only trailing message spacer", () => {
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>[\s\S]*?<div ref=\{messagesEndRef\} \/>/);
  assert.doesNotMatch(chatWindowSource, /bottomComposer(?:Ref|Height|ScrollFrameRef)/);
  assert.doesNotMatch(chatWindowSource, /new ResizeObserver\(updateBottomComposerHeight\)/);
});

test("keeps a detached viewport in place when streaming completes", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load model list"),
  );

  assert.match(scrollEffectSource, /!agentRunningRef\.current && isNearBottomRef\.current[\s\S]*?scrollToBottom\("auto"\)/);
  assert.doesNotMatch(scrollEffectSource, /\|\|/);
  assert.match(source, /addEventListener\("scroll", handleScrollPositionChange/);
});
