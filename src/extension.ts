import * as vscode from "vscode";

const GO_VENDOR = "opencodego";
const ZEN_VENDOR = "opencodezen";
const SECRET_KEY = "opencodego.apiKey";

interface ProviderDefinition {
  vendor: typeof GO_VENDOR | typeof ZEN_VENDOR;
  displayName: string;
  modelNamePrefix: string;
  modelsUrl: string;
  chatCompletionsUrl: string;
  messagesUrl: string;
  categoryOrder: number;
  testModelId: string;
  fallbackModels: string[];
  filterModel?: (modelId: string) => boolean;
}

const FREE_ZEN_MODEL_IDS = new Set(["big-pickle"]);
const MODELS_DEV_API_URL = "https://models.dev/api.json";
const KNOWN_UNAVAILABLE_MODEL_IDS = new Set([
  "ring-2.6-1t",
  "ring-2.6-1t-free",
  "trinity-large-preview-free"
]);
// Bump this when we need to force VS Code picker metadata refresh.
const MODEL_METADATA_REVISION = "ctxfix-2026-05-16-c";

const PROVIDERS: Record<ProviderDefinition["vendor"], ProviderDefinition> = {
  [GO_VENDOR]: {
    vendor: GO_VENDOR,
    displayName: "OpenCode Go",
    modelNamePrefix: "OpenCode Go",
    modelsUrl: "https://opencode.ai/zen/go/v1/models",
    chatCompletionsUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    messagesUrl: "https://opencode.ai/zen/go/v1/messages",
    categoryOrder: 2,
    testModelId: "deepseek-v4-flash",
    fallbackModels: [
      "minimax-m2.7",
      "minimax-m2.5",
      "kimi-k2.6",
      "kimi-k2.5",
      "glm-5.1",
      "glm-5",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "qwen3.6-plus",
      "qwen3.6-plus-free",
      "qwen3.5-plus",
      "mimo-v2-pro",
      "mimo-v2-omni",
      "mimo-v2.5-pro",
      "mimo-v2.5",
      "hy3-preview"
    ]
  },
  [ZEN_VENDOR]: {
    vendor: ZEN_VENDOR,
    displayName: "OpenCode Zen",
    modelNamePrefix: "OpenCode Zen",
    modelsUrl: "https://opencode.ai/zen/v1/models",
    chatCompletionsUrl: "https://opencode.ai/zen/v1/chat/completions",
    messagesUrl: "https://opencode.ai/zen/v1/messages",
    categoryOrder: 3,
    testModelId: "deepseek-v4-flash-free",
    fallbackModels: [
      "deepseek-v4-flash-free",
      "minimax-m2.5-free",
      "nemotron-3-super-free",
      "qwen3.6-plus-free",
      "big-pickle"
    ],
    filterModel: (modelId) => vscode.workspace.getConfiguration("opencodego").get("freeOnly", true) ? modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId) : true
  }
};

type ApiRole = "user" | "assistant" | "tool";

interface OpenCodeModel extends vscode.LanguageModelChatInformation {
  endpointKind: "chat-completions" | "messages";
  provider: ProviderDefinition;
  rawModelId?: string;
  category?: {
    label: string;
    order: number;
  };
  isUserSelectable?: boolean;
}

interface ModelListResponse {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
}

interface ModelsDevResponse {
  opencode?: {
    models?: Record<string, {
      status?: string;
    }>;
  };
}

interface ApiMessage {
  role: ApiRole;
  content: string | null | OpenAiContentPart[];
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ApiSettings {
  temperature: number;
  maxOutputTokensOverride: number;
  maxInputTokensOverride: number;
  debugReasoning: boolean;
}

interface LanguageModelConfiguration {
  apiKey?: unknown;
}

type ConfiguredLanguageModelInfoOptions = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: LanguageModelConfiguration;
};

type ConfiguredLanguageModelResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  configuration?: LanguageModelConfiguration;
};

interface BaseModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

interface ModelLimits extends BaseModelLimits {
  advertisedContextWindow: number;
  advertisedMaxInputTokens: number;
  advertisedMaxOutputTokens: number;
}

// Copilot surfaces combine input/output metadata differently across views.
// Reserve a modest UI output budget, while requests still use the real model max.
const UI_OUTPUT_TOKEN_RESERVE = 8192;

const DEFAULT_MODEL_LIMITS: BaseModelLimits = {
  contextWindow: 262144,
  maxOutputTokens: 65536
};

// Context limits sourced from models.dev (official OpenCode model registry).
// Keep limits per provider to avoid cross-provider contamination in VS Code's
// picker metadata cache.
const MODEL_LIMITS_BY_PROVIDER: Record<ProviderDefinition["vendor"], Record<string, BaseModelLimits>> = {
  [GO_VENDOR]: {
    "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "mimo-v2.5": { contextWindow: 1000000, maxOutputTokens: 128000 },
    "mimo-v2.5-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "mimo-v2-omni": { contextWindow: 262144, maxOutputTokens: 128000 },
    "mimo-v2-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "kimi-k2.6": { contextWindow: 262144, maxOutputTokens: 65536 },
    "kimi-k2.5": { contextWindow: 262144, maxOutputTokens: 65536 },
    "glm-5.1": { contextWindow: 204800, maxOutputTokens: 131072 },
    "glm-5": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.7": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.5": { contextWindow: 204800, maxOutputTokens: 131072 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "hy3-preview": { contextWindow: 256000, maxOutputTokens: 64000 },
    "ring-2.6-1t": { contextWindow: 262000, maxOutputTokens: 66000 }
  },
  [ZEN_VENDOR]: {
    "deepseek-v4-flash-free": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "minimax-m2.5-free": { contextWindow: 204800, maxOutputTokens: 131072 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.6-plus-free": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "trinity-large-preview-free": { contextWindow: 131072, maxOutputTokens: 131072 },
    "nemotron-3-super-free": { contextWindow: 204800, maxOutputTokens: 128000 },
    "big-pickle": { contextWindow: 200000, maxOutputTokens: 128000 }
  }
};

type CopilotCompatibleCapabilities = vscode.LanguageModelChatCapabilities & {
  supportsToolCalling: boolean;
  supportsImageToText: boolean;
};

// Models live on the OpenCode Zen gateway but with constrained GPU capacity.
// They were re-enabled by the OpenCode team after a brief shutdown
// ("Qwen 3.6 Plus — free, again. Round 2. We found more GPUs.") so they are
// NOT deprecated, but agentic workloads with long histories or large tool
// catalogs can still hit 5xx during traffic bursts. Surface this so users know
// to retry or fall back to another free model if the request fails.
const CAPACITY_LIMITED_MODEL_NOTES: Record<string, string> = {
  "qwen3.6-plus-free": "Free relaunch with limited GPU capacity. Stable for short prompts; bursty traffic or very large tool catalogs may return 5xx — retry or fall back to 'deepseek-v4-flash-free' / 'minimax-m2.5-free'. Paid 'qwen3.6-plus' has no quota."
};

let deprecatedOpenCodeModelIdsPromise: Promise<Set<string>> | undefined;

const VISION_CAPABLE_MODELS = new Set([
  "minimax-m2.7",
  "minimax-m2.5",
  "minimax-m2.5-free",
  "kimi-k2.6",
  "kimi-k2.5",
  "glm-5.1",
  "glm-5",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "mimo-v2-omni",
  "mimo-v2-pro",
  "qwen3.6-plus",
  "qwen3.6-plus-free",
  "qwen3.5-plus"
]);

interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

export function activate(context: vscode.ExtensionContext) {
  const goProvider = new OpenCodeProvider(context, PROVIDERS[GO_VENDOR]);
  const zenProvider = new OpenCodeProvider(context, PROVIDERS[ZEN_VENDOR]);

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(GO_VENDOR, goProvider),
    vscode.lm.registerLanguageModelChatProvider(ZEN_VENDOR, zenProvider),
    vscode.commands.registerCommand("opencodego.manage", () => goProvider.manage()),
    vscode.commands.registerCommand("opencodego.diagnostics", () => goProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodego.setApiKey", () => goProvider.setApiKey()),
    vscode.commands.registerCommand("opencodezen.diagnostics", () => zenProvider.showDiagnostics())
  );

}

export function deactivate() {
  // Nothing to clean up.
}

class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  private readonly apiKeysByModelId = new Map<string, string>();
  private readonly reasoningContentByToolCallId = new Map<string, string>();
  private outputChannel: vscode.OutputChannel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly definition: ProviderDefinition
  ) {}

  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("OpenCode");
      this.context.subscriptions.push(this.outputChannel);
    }
    return this.outputChannel;
  }

  private log(message: string): void {
    this.getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  async manage(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);

    if (!apiKey) {
      await this.setApiKey();
      return;
    }

    const choice = await vscode.window.showQuickPick(
      [
        { label: "Set API Key", action: "set" as const },
        { label: "Clear API Key", action: "clear" as const },
        { label: "Test Connection", action: "test" as const },
        { label: "Refresh Models", action: "refresh" as const }
      ],
      {
        title: `Manage ${this.definition.displayName}`,
        placeHolder: "Choose an action"
      }
    );

    if (!choice) {
      return;
    }

    if (choice.action === "set") {
      await this.setApiKey();
      return;
    }

    if (choice.action === "clear") {
      await this.context.secrets.delete(SECRET_KEY);
      this.changeEmitter.fire();
      vscode.window.showInformationMessage("OpenCode Go API key cleared.");
      return;
    }

    if (choice.action === "test") {
      await this.testConnection();
      return;
    }

    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} models refreshed.`);
  }

  async testConnection(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      vscode.window.showErrorMessage(`${this.definition.displayName}: No API key set. Use 'Set API Key' first.`);
      return;
    }

    const statusBar = vscode.window.setStatusBarMessage(`$(loading~spin) Testing ${this.definition.displayName} connection...`);
    this.log(`Testing connection to ${this.definition.chatCompletionsUrl}`);

    try {
      const response = await fetch(this.definition.chatCompletionsUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.definition.testModelId,
          messages: [{ role: "user", content: "reply with just: ok" }],
          max_tokens: 10,
          stream: false
        })
      });

      const responseText = await response.text();
      statusBar.dispose();
      this.log(`Test response (${response.status}): ${responseText}`);
      this.getOutputChannel().show(true);

      if (response.ok) {
        vscode.window.showInformationMessage(`${this.definition.displayName}: Connection OK (HTTP ${response.status}). Check Output panel for details.`);
      } else {
        vscode.window.showErrorMessage(`${this.definition.displayName}: Connection failed (HTTP ${response.status}). Check Output panel for details.`);
      }
    } catch (error) {
      statusBar.dispose();
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Test connection error: ${message}`);
      this.getOutputChannel().show(true);
      vscode.window.showErrorMessage(`${this.definition.displayName}: Connection error - ${message}`);
    }
  }

  async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      title: "OpenCode Go API Key",
      prompt: "Paste your OpenCode Go API key. It will be stored securely in VS Code SecretStorage.",
      password: true,
      ignoreFocusOut: true
    });

    if (!apiKey) {
      return;
    }

    await this.context.secrets.store(SECRET_KEY, apiKey.trim());
    this.changeEmitter.fire();
    vscode.window.showInformationMessage("OpenCode Go API key saved.");
  }

  async showDiagnostics(): Promise<void> {
    const models = await vscode.lm.selectChatModels({ vendor: this.definition.vendor });
    const lines = models.map((model) => {
      const rawModelId = resolveRawModelId(model.id);
      const limits = modelLimits(rawModelId, undefined, this.definition.vendor);
      return [
      `- ${rawModelId}`,
      `  rawModelId: ${rawModelId}`,
      `  name: ${model.name}`,
      `  family: ${model.family}`,
      `  vendor: ${model.vendor}`,
      `  version: ${model.version}`,
      `  maxInputTokens: ${model.maxInputTokens}`,
      `  advertisedMaxOutputTokens: ${limits.advertisedMaxOutputTokens}`,
      `  advertisedContextWindow: ${limits.advertisedContextWindow}`,
      `  apiMaxOutputTokens: ${limits.maxOutputTokens}`,
      ...(hasExplicitModelLimits(rawModelId, this.definition.vendor) ? [] : ["  limits: using default fallback"])
      ].join("\n");
    });

    const content = [
      `# ${this.definition.displayName} Diagnostics`,
      "",
      `Models visible through vscode.lm.selectChatModels({ vendor: "${this.definition.vendor}" }): ${models.length}`,
      "",
      ...lines
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<OpenCodeModel[]> {
    const apiKey = getConfiguredApiKey(options as ConfiguredLanguageModelInfoOptions);

    if (!apiKey) {
      return [];
    }

    if (token.isCancellationRequested) {
      return [];
    }

    const models = await this.fetchModels();
    const settings = getSettings();

    return models.map((modelId) => {
      const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
      const limits = modelLimits(modelId, settings, this.definition.vendor);
      this.apiKeysByModelId.set(modelId, apiKey);
      this.apiKeysByModelId.set(effectiveModelId, apiKey);

      const capacityNote = CAPACITY_LIMITED_MODEL_NOTES[modelId];
      const baseDetail = this.definition.vendor === ZEN_VENDOR && isFreeZenModel(modelId) ? "Free" : this.definition.displayName;
      const baseTooltip = `${this.definition.displayName} model: ${modelId}`;

      return {
        id: effectiveModelId,
        rawModelId: modelId,
        name: `${this.definition.modelNamePrefix} / ${formatModelName(modelId)}`,
        family: `${this.definition.vendor}-${modelId}-${MODEL_METADATA_REVISION}`,
        // Include effective limits in version so VS Code invalidates stale
        // picker metadata after limit changes (eg. 2M -> 262K corrections).
        version: `1.2.0-${MODEL_METADATA_REVISION}-${limits.contextWindow}-${limits.maxOutputTokens}`,
        detail: capacityNote ? `${baseDetail} • Limited capacity` : baseDetail,
        tooltip: capacityNote ? `${baseTooltip}\n\nℹ ${capacityNote}` : baseTooltip,
        category: {
          label: this.definition.displayName,
          order: this.definition.categoryOrder
        },
        isUserSelectable: true,
        maxInputTokens: limits.advertisedMaxInputTokens,
        maxOutputTokens: limits.advertisedMaxOutputTokens,
        capabilities: modelCapabilities(modelId),
        endpointKind: modelEndpointKind(modelId, this.definition),
        provider: this.definition
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: OpenCodeModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey =
      getConfiguredApiKey(options as ConfiguredLanguageModelResponseOptions)
      ?? this.apiKeysByModelId.get(model.id);

    if (!apiKey) {
      throw new Error(`${this.definition.displayName} API key is required. Use the ${this.definition.displayName} gear icon in Language Models to configure it, then reload the window.`);
    }

    const apiMessages = normalizeMessages(messages.flatMap((message) => convertMessage(message, this.reasoningContentByToolCallId)));
    const settings = getSettings();
    const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
    const limits = modelLimits(rawModelId, settings, model.provider.vendor);

    this.log(`Request: model=${model.id} rawModel=${rawModelId} endpoint=${model.endpointKind} messages=${apiMessages.length}`);
    if (settings.debugReasoning) {
      this.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
    }

    try {
      if (model.endpointKind === "messages") {
        await streamAnthropicMessages(this.definition.messagesUrl, this.definition.displayName, apiKey, rawModelId, apiMessages, options, settings, limits, progress, token, this.getOutputChannel());
        return;
      }

      await streamChatCompletions(
        this.definition.chatCompletionsUrl,
        this.definition.displayName,
        apiKey,
        rawModelId,
        apiMessages,
        options,
        settings,
        limits,
        progress,
        token,
        this.getOutputChannel(),
        (toolCallIds, reasoningContent) => {
          for (const toolCallId of toolCallIds) {
            this.reasoningContentByToolCallId.set(toolCallId, reasoningContent);
          }
        }
      );
      this.log(`Request completed: model=${model.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`ERROR model=${model.id}: ${message}`);
      this.getOutputChannel().show(true);
      throw error;
    }
  }

  async provideTokenCount(
    _model: OpenCodeModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const value = typeof text === "string" ? text : messageText(text);
    return estimateTokenCount(value);
  }

  private async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(this.definition.modelsUrl);

      if (!response.ok) {
        throw new Error(`Model list request failed (${response.status}): ${response.statusText}`);
      }

      const data = await response.json() as ModelListResponse;
      const ids = data.data
        ?.map((model) => model.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .filter((id) => this.definition.filterModel?.(id) ?? true);

      return this.filterAvailableModels(ids?.length ? ids : this.definition.fallbackModels);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`Could not fetch ${this.definition.displayName} model list. Using bundled model list. ${message}`);
      return this.filterAvailableModels(this.definition.fallbackModels);
    }
  }

  private async filterAvailableModels(modelIds: string[]): Promise<string[]> {
    const uniqueModelIds = [...new Set(modelIds)];

    try {
      const deprecatedModelIds = await fetchDeprecatedOpenCodeModelIds();
      const filteredModelIds = uniqueModelIds.filter((modelId) =>
        !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId)
        && !deprecatedModelIds.has(modelId)
      );

      const removedModelIds = uniqueModelIds.filter((modelId) => !filteredModelIds.includes(modelId));
      if (removedModelIds.length) {
        this.log(`Filtered unavailable/deprecated models: ${removedModelIds.join(", ")}`);
      }

      return filteredModelIds;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not fetch model status metadata from models.dev. Applying local unavailable model filter only. ${message}`);
      return uniqueModelIds.filter((modelId) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId));
    }
  }

}

function getConfiguredApiKey(options?: { configuration?: LanguageModelConfiguration }): string | undefined {
  const configuredApiKey = options?.configuration?.apiKey;
  return typeof configuredApiKey === "string" && configuredApiKey.trim() ? configuredApiKey.trim() : undefined;
}

async function fetchDeprecatedOpenCodeModelIds(): Promise<Set<string>> {
  deprecatedOpenCodeModelIdsPromise ??= (async () => {
    const response = await fetch(MODELS_DEV_API_URL);

    if (!response.ok) {
      throw new Error(`models.dev request failed (${response.status}): ${response.statusText}`);
    }

    const data = await response.json() as ModelsDevResponse;
    const models = data.opencode?.models ?? {};
    const deprecatedModelIds = new Set<string>();

    for (const [modelId, model] of Object.entries(models)) {
      if (model.status === "deprecated") {
        deprecatedModelIds.add(modelId);
      }
    }

    return deprecatedModelIds;
  })();

  return deprecatedOpenCodeModelIdsPromise;
}

async function streamChatCompletions(
  url: string,
  providerDisplayName: string,
  apiKey: string,
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  limits: ModelLimits,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  output: vscode.OutputChannel,
  onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void
): Promise<void> {
  const tools = mapOpenAiTools(options.tools);
  const extractor = new OpenAiResponseExtractor(onReasoningContent, (reasoningContent) => {
    if (settings.debugReasoning) {
      output.appendLine("[reasoning_content]");
      output.appendLine(reasoningContent);
      output.appendLine("[/reasoning_content]");
    }
  });

  // Qwen3 family ships with hybrid thinking mode enabled by default. When that
  // happens via the OpenAI-compatible endpoint, the stream only contains
  // delta.reasoning_content and delta.content stays empty, which surfaces as
  // "request completed but no output" in Copilot. Disable it explicitly so the
  // model writes its answer into delta.content. We still keep the reasoning
  // fallback below to cover other providers that ignore the flag.
  const isQwen = /^qwen3(?:\.|-)/i.test(modelId);
  const qwenThinkingPatch = isQwen ? { enable_thinking: false } : {};

  await streamOpenCodeResponse(
    url,
    providerDisplayName,
    apiKey,
    {
      model: modelId,
      messages,
      temperature: settings.temperature,
      max_tokens: limits.maxOutputTokens,
      stream: true,
      ...qwenThinkingPatch,
      ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {})
    },
    progress,
    token,
    (data) => extractor.extractStreamParts(data),
    extractChatCompletionParts,
    output,
    settings.debugReasoning
  );

  extractor.flushReasoningFallback(progress);
  output.appendLine(`[stream-summary model=${modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`);
  if (extractor.emittedText === 0 && extractor.emittedTools === 0) {
    output.appendLine(`[warn] empty response from model=${modelId} (no text, no tool calls, no reasoning). Try a different free model or enable opencodego.debugReasoning to inspect raw SSE.`);
    output.show(true);
  }
}

async function streamAnthropicMessages(
  url: string,
  providerDisplayName: string,
  apiKey: string,
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  limits: ModelLimits,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  output?: vscode.OutputChannel
): Promise<void> {
  const tools = mapAnthropicTools(options.tools);
  const extractor = new AnthropicResponseExtractor();

  await streamOpenCodeResponse(
    url,
    providerDisplayName,
    apiKey,
    {
      model: modelId,
      messages,
      temperature: settings.temperature,
      max_tokens: limits.maxOutputTokens,
      stream: true,
      ...(tools.length ? { tools, tool_choice: anthropicToolChoice(options.toolMode) } : {})
    },
    progress,
    token,
    (data) => extractor.extractStreamParts(data),
    extractAnthropicParts,
    output,
    settings.debugReasoning
  );
}

function mapOpenAiTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): OpenAiToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

function mapAnthropicTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): AnthropicToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? { type: "object", properties: {} }
  }));
}

function toolChoice(mode: vscode.LanguageModelChatToolMode): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}

function anthropicToolChoice(mode: vscode.LanguageModelChatToolMode): { type: "auto" | "any" } {
  return { type: mode === vscode.LanguageModelChatToolMode.Required ? "any" : "auto" };
}

async function streamOpenCodeResponse(
  url: string,
  providerDisplayName: string,
  apiKey: string,
  body: unknown,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  extractStreamParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  extractFullParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  output?: vscode.OutputChannel,
  verbose: boolean = false
): Promise<void> {
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => controller.abort());

  try {
    const payload = JSON.stringify(body);
    output?.appendLine(`[request] url=${url} payloadBytes=${payload.length}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: payload,
      signal: controller.signal
    });

    output?.appendLine(`[http] ${response.status} ${response.statusText} content-type=${response.headers.get("content-type") ?? "<none>"}`);

    if (!response.ok) {
      const detail = await response.text();
      const modelId = (isRecord(body) && typeof (body as { model?: unknown }).model === "string") ? (body as { model: string }).model : undefined;
      const modelHint = modelId ? ` model=${modelId}` : "";
      const sizeHint = ` payloadBytes=${payload.length}`;
      const capacityHint = (modelId && CAPACITY_LIMITED_MODEL_NOTES[modelId] && response.status >= 500) ? ` — ${CAPACITY_LIMITED_MODEL_NOTES[modelId]}` : "";
      throw new Error(`${providerDisplayName} API request failed (${response.status})${modelHint}${sizeHint}${capacityHint}: ${detail || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.includes("text/event-stream")) {
      const raw = await response.text();
      output?.appendLine(`[non-stream-body] ${truncateForLog(raw)}`);
      let data: unknown;
      try { data = JSON.parse(raw); } catch { data = undefined; }
      if (data !== undefined) {
        for (const part of extractFullParts(data)) {
          progress.report(part);
        }
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let totalEvents = 0;

    while (!token.isCancellationRequested) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value?.byteLength ?? 0;
      const chunk = decoder.decode(value, { stream: true });
      if (verbose && output && chunk) {
        output.appendLine(`[sse-raw bytes=${value?.byteLength ?? 0}] ${truncateForLog(chunk)}`);
      }
      buffer += chunk;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        totalEvents++;
        if (verbose && output && event.trim()) {
          output.appendLine(`[sse] ${truncateForLog(event)}`);
        }
        for (const part of parseServerSentEvent(event, extractStreamParts)) {
          progress.report(part);
        }
      }
    }

    if (buffer.trim()) {
      if (verbose && output) {
        output.appendLine(`[sse-tail] ${truncateForLog(buffer)}`);
      }
      for (const part of parseServerSentEvent(buffer, extractStreamParts)) {
        progress.report(part);
      }
    }

    if (output) {
      output.appendLine(`[sse-stats] totalBytes=${totalBytes} totalEvents=${totalEvents} bufferTailLen=${buffer.length}`);
    }
  } finally {
    cancellation.dispose();
  }
}

function truncateForLog(value: string, max = 1200): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}… (+${collapsed.length - max} chars)` : collapsed;
}

function parseServerSentEvent(
  event: string,
  extractParts: (data: unknown) => vscode.LanguageModelResponsePart[]
): vscode.LanguageModelResponsePart[] {
  const lines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const parts: vscode.LanguageModelResponsePart[] = [];

  for (const line of lines) {
    if (!line || line === "[DONE]") {
      continue;
    }

    try {
      const data = JSON.parse(line) as unknown;
      parts.push(...extractParts(data));
    } catch {
      // Ignore malformed SSE lines; the API may send comments or keep-alive frames.
    }
  }

  return parts;
}

function convertMessage(
  message: vscode.LanguageModelChatRequestMessage,
  reasoningContentByToolCallId: ReadonlyMap<string, string>
): ApiMessage[] {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const textParts: string[] = [];
  const imageParts: OpenAiContentPart[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  const toolResults: ApiMessage[] = [];

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input ?? {})
        }
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelToolResultPart) {
      toolResults.push({
        role: "tool",
        tool_call_id: part.callId,
        content: part.content.map(partToText).filter(Boolean).join("\n")
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      const base64 = btoa(String.fromCodePoint(...part.data));
      imageParts.push({
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${base64}` }
      });
      continue;
    }

    const text = partToText(part);
    if (text) {
      textParts.push(text);
    }
  }

  // Build content: use multimodal array if images present, otherwise plain string
  const hasImages = imageParts.length > 0;
  const textContent = textParts.join("\n");

  let content: string | null | OpenAiContentPart[] = textContent;
  if (hasImages) {
    const multimodal: OpenAiContentPart[] = [];
    if (textContent) {
      multimodal.push({ type: "text", text: textContent });
    }
    multimodal.push(...imageParts);
    content = multimodal;
  }

  if (role === "assistant" && toolCalls.length) {
    return [{
      role,
      content: typeof content === "string" ? content || null : content,
      reasoning_content: reasoningForToolCalls(toolCalls, reasoningContentByToolCallId),
      tool_calls: toolCalls
    }];
  }

  if (toolResults.length) {
    return content ? [{ role, content }, ...toolResults] : toolResults;
  }

  return [{ role, content }];
}

function reasoningForToolCalls(
  toolCalls: OpenAiToolCall[],
  reasoningContentByToolCallId: ReadonlyMap<string, string>
): string | undefined {
  const reasoning = toolCalls
    .map((toolCall) => reasoningContentByToolCallId.get(toolCall.id))
    .filter((value): value is string => Boolean(value?.trim()));

  return reasoning.length ? reasoning.join("\n") : undefined;
}

function messageText(message: vscode.LanguageModelChatRequestMessage): string {
  return message.content.map(partToText).filter(Boolean).join("\n");
}

function partToText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    return part.content.map(partToText).filter(Boolean).join("\n");
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    return `[Tool call: ${part.name} ${JSON.stringify(part.input)}]`;
  }

  if (typeof part === "string") {
    return part;
  }

  return "";
}

function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
  const normalized: ApiMessage[] = [];

  for (const message of messages) {
    if (!hasMessagePayload(message)) {
      continue;
    }

    const previous = normalized.at(-1);
    const prevContent = previous?.content;
    const msgContent = message.content;
    const prevIsString = typeof prevContent === "string";
    const msgIsString = typeof msgContent === "string";
    const prevHasToolCalls = !!(previous?.tool_calls?.length || previous?.tool_call_id);
    const msgHasToolCalls = !!(message.tool_calls?.length || message.tool_call_id);

    if (
      previous?.role === message.role
      && message.role !== "tool"
      && prevIsString && msgIsString
      && !prevHasToolCalls && !msgHasToolCalls
    ) {
      previous.content = `${prevContent ?? ""}\n\n${msgContent ?? ""}`.trim();
    } else {
      normalized.push({ ...message });
    }
  }

  if (normalized[0]?.role === "assistant") {
    normalized.unshift({
      role: "user",
      content: "Continue the conversation based on the prior assistant message."
    });
  }

  return normalized.length ? normalized : [{ role: "user", content: "" }];
}

function hasMessagePayload(message: ApiMessage): boolean {
  if (message.tool_calls?.length || message.tool_call_id) {
    return true;
  }

  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }

  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }

  return false;
}

class OpenAiResponseExtractor {
  private readonly pendingToolCalls = new Map<number, PendingToolCall>();
  private reasoningContent = "";
  private emittedTextLength = 0;
  private emittedToolCallsCount = 0;

  constructor(
    private readonly onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void,
    private readonly onReasoningDebug?: (reasoningContent: string) => void
  ) {}

  get emittedText(): number { return this.emittedTextLength; }
  get emittedTools(): number { return this.emittedToolCallsCount; }
  get reasoningChars(): number { return this.reasoningContent.length; }

  extractStreamParts(data: unknown): vscode.LanguageModelResponsePart[] {
    if (!isRecord(data) || !Array.isArray(data.choices)) {
      return [];
    }

    const first = data.choices[0];
    if (!isRecord(first)) {
      return [];
    }

    const parts: vscode.LanguageModelResponsePart[] = [];
    const delta = first.delta;
    if (isRecord(delta)) {
      const text = extractTextFromDelta(delta);
      if (text) {
        this.emittedTextLength += text.length;
        parts.push(new vscode.LanguageModelTextPart(text));
      }
      const reasoning = extractReasoningFromDelta(delta);
      if (reasoning) {
        this.reasoningContent += reasoning;
      }
      this.collectOpenAiToolCalls(delta.tool_calls);
    }

    // Some gateways place the assembled content under choices[].message at end of stream.
    const message = first.message;
    if (isRecord(message)) {
      const text = extractTextFromDelta(message);
      if (text) {
        this.emittedTextLength += text.length;
        parts.push(new vscode.LanguageModelTextPart(text));
      }
      const reasoning = extractReasoningFromDelta(message);
      if (reasoning) {
        this.reasoningContent += reasoning;
      }
      this.collectOpenAiToolCalls(message.tool_calls);
    }

    if (first.finish_reason === "tool_calls") {
      const toolParts = this.flushToolCalls();
      this.emittedToolCallsCount += toolParts.length;
      parts.push(...toolParts);
    }

    return parts;
  }

  // Some upstream providers (e.g. Qwen with thinking mode forced on) finish a
  // stream emitting only reasoning_content and never produce delta.content.
  // To avoid an empty Copilot response, surface the accumulated reasoning as
  // text when nothing else was emitted.
  flushReasoningFallback(progress: vscode.Progress<vscode.LanguageModelResponsePart>): void {
    const reasoning = this.reasoningContent.trim();
    if (!reasoning) {
      return;
    }
    if (this.emittedTextLength > 0 || this.emittedToolCallsCount > 0) {
      this.reasoningContent = "";
      return;
    }
    this.onReasoningDebug?.(this.reasoningContent);
    progress.report(new vscode.LanguageModelTextPart(reasoning));
    this.emittedTextLength += reasoning.length;
    this.reasoningContent = "";
  }

  private collectOpenAiToolCalls(toolCalls: unknown): void {
    if (!Array.isArray(toolCalls)) {
      return;
    }

    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) {
        continue;
      }

      const index = typeof toolCall.index === "number" ? toolCall.index : this.pendingToolCalls.size;
      const pending = this.pendingToolCalls.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof toolCall.id === "string") {
        pending.id = toolCall.id;
      }

      const fn = toolCall.function;
      if (isRecord(fn)) {
        if (typeof fn.name === "string") {
          pending.name += fn.name;
        }
        if (typeof fn.arguments === "string") {
          pending.arguments += fn.arguments;
        }
      }

      this.pendingToolCalls.set(index, pending);
    }
  }

  private flushToolCalls(): vscode.LanguageModelToolCallPart[] {
    const toolCalls = Array.from(this.pendingToolCalls.values())
      .filter((toolCall) => toolCall.name);
    const parts = toolCalls
      .map((toolCall, index) => new vscode.LanguageModelToolCallPart(
        toolCall.id || `opencodego-tool-${Date.now()}-${index}`,
        toolCall.name,
        parseToolInput(toolCall.arguments)
      ));

    if (this.reasoningContent.trim()) {
      this.onReasoningDebug?.(this.reasoningContent);
      this.onReasoningContent?.(parts.map((part) => part.callId), this.reasoningContent);
    }

    this.pendingToolCalls.clear();
    this.reasoningContent = "";
    return parts;
  }
}

function extractChatCompletionParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return [];
  }

  const first = data.choices[0];
  if (!isRecord(first)) {
    return [];
  }

  const parts: vscode.LanguageModelResponsePart[] = [];
  const message = first.message;
  if (isRecord(message)) {
    const text = extractTextFromDelta(message);
    if (text) {
      parts.push(new vscode.LanguageModelTextPart(text));
    } else {
      // No primary text — fall back to reasoning so the user sees something.
      const reasoning = extractReasoningFromDelta(message);
      if (reasoning.trim()) {
        parts.push(new vscode.LanguageModelTextPart(reasoning));
      }
    }
    for (const toolCallPart of toolCallPartsFromOpenAiMessage(message.tool_calls, typeof message.reasoning_content === "string" ? message.reasoning_content : undefined)) {
      parts.push(toolCallPart);
    }
  }

  if (typeof first.text === "string") {
    parts.push(new vscode.LanguageModelTextPart(first.text));
  }

  return parts;
}

// Some OpenAI-compatible gateways stream content as a string, others as an array
// of content parts (e.g. [{type:"text",text:"..."}]) or under alternate keys
// like `text` / `output_text`. Normalise all of these into a single string.
function extractTextFromDelta(delta: Record<string, unknown>): string {
  const candidates: unknown[] = [delta.content, delta.text, delta.output_text];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      collected += candidate;
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part)) {
          const t = part.text ?? part.value ?? part.output_text;
          if (typeof t === "string") {
            collected += t;
          }
        }
      }
    }
  }
  return collected;
}

function extractReasoningFromDelta(delta: Record<string, unknown>): string {
  const candidates: unknown[] = [
    delta.reasoning_content,
    delta.reasoning,
    delta.thinking,
    isRecord(delta.message) ? (delta.message as Record<string, unknown>).reasoning_content : undefined
  ];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      collected += candidate;
    } else if (isRecord(candidate) && typeof candidate.content === "string") {
      collected += candidate.content;
    } else if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part) && typeof part.text === "string") {
          collected += part.text;
        }
      }
    }
  }
  return collected;
}

class AnthropicResponseExtractor {
  extractStreamParts(data: unknown): vscode.LanguageModelResponsePart[] {
    if (!isRecord(data)) {
      return [];
    }

    const delta = data.delta;
    if (isRecord(delta) && typeof delta.text === "string") {
      return [new vscode.LanguageModelTextPart(delta.text)];
    }

    return [];
  }
}

function extractAnthropicParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    return [];
  }

  const text = data.content
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
    .join("");

  return text ? [new vscode.LanguageModelTextPart(text)] : [];
}

function toolCallPartsFromOpenAiMessage(toolCalls: unknown, _reasoningContent?: string): vscode.LanguageModelToolCallPart[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .filter(isRecord)
    .map((toolCall, index) => {
      const fn = toolCall.function;
      const id = typeof toolCall.id === "string" ? toolCall.id : `opencodego-tool-${Date.now()}-${index}`;
      const name = isRecord(fn) && typeof fn.name === "string" ? fn.name : "";
      const args = isRecord(fn) && typeof fn.arguments === "string" ? fn.arguments : "{}";
      return name ? new vscode.LanguageModelToolCallPart(id, name, parseToolInput(args)) : undefined;
    })
    .filter((part): part is vscode.LanguageModelToolCallPart => Boolean(part));
}

function parseToolInput(value: string): object {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration("opencodego");

  return {
    temperature: config.get("temperature", 0.2),
    maxOutputTokensOverride: config.get("maxTokens", 0),
    maxInputTokensOverride: config.get("maxInputTokens", 0),
    debugReasoning: config.get("debugReasoning", false)
  };
}

function modelLimits(
  modelId: string,
  settings = getSettings(),
  vendor: ProviderDefinition["vendor"] = ZEN_VENDOR
): ModelLimits {
  const limits = MODEL_LIMITS_BY_PROVIDER[vendor][modelId] ?? DEFAULT_MODEL_LIMITS;
  const contextWindow = positiveOverride(settings.maxInputTokensOverride) ?? limits.contextWindow;
  const maxOutputTokens = positiveOverride(settings.maxOutputTokensOverride) ?? limits.maxOutputTokens;
  const apiMaxOutputTokens = Math.min(maxOutputTokens, contextWindow);
  // advertisedContextWindow = actual model context window (not inflated).
  // Adding apiMaxOutputTokens here inflates the value above the real limit,
  // which causes VS Code to round up and display "2M" instead of "1M" for a
  // 1M-context model, and worse: VS Code may try to send payloads larger than
  // the model's actual total context window.
  const advertisedContextWindow = contextWindow;
  const advertisedMaxOutputTokens = Math.max(1, Math.min(apiMaxOutputTokens, UI_OUTPUT_TOKEN_RESERVE));

  return {
    contextWindow,
    maxOutputTokens: apiMaxOutputTokens,
    advertisedContextWindow,
    advertisedMaxInputTokens: Math.max(1, advertisedContextWindow - advertisedMaxOutputTokens),
    advertisedMaxOutputTokens
  };
}

function estimateTokenCount(value: string): number {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const words = normalized.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);

  return Math.max(1, Math.ceil(Math.max(words * 1.15, charEstimate, cjkCharacters)));
}

function positiveOverride(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function modelCapabilities(modelId: string): CopilotCompatibleCapabilities {
  const supportsVision = VISION_CAPABLE_MODELS.has(modelId);
  return {
    imageInput: supportsVision,
    toolCalling: 128,
    supportsImageToText: supportsVision,
    supportsToolCalling: true
  };
}

function modelEndpointKind(modelId: string, provider: ProviderDefinition): OpenCodeModel["endpointKind"] {
  if (provider.vendor === GO_VENDOR && modelId.startsWith("minimax-m2.")) {
    return "messages";
  }

  // Qwen3.x via OpenCode gateway returns Anthropic-style SSE (event:message_start,
  // content_block_delta, text_delta) even on the /chat/completions endpoint, so
  // route them through the /messages parser to actually capture the output.
  if (/^qwen3(?:\.|-)/i.test(modelId)) {
    return "messages";
  }

  return "chat-completions";
}

function toEffectiveModelId(modelId: string, vendor: ProviderDefinition["vendor"]): string {
  return `${vendor}:${modelId}::${MODEL_METADATA_REVISION}`;
}

function resolveRawModelId(modelId: string): string {
  const [base] = modelId.split("::");
  const prefix = `${GO_VENDOR}:`;
  const zenPrefix = `${ZEN_VENDOR}:`;
  if (base.startsWith(prefix)) {
    return base.slice(prefix.length);
  }
  if (base.startsWith(zenPrefix)) {
    return base.slice(zenPrefix.length);
  }
  return base;
}

function hasExplicitModelLimits(modelId: string, vendor: ProviderDefinition["vendor"]): boolean {
  return Boolean(MODEL_LIMITS_BY_PROVIDER[vendor][modelId]);
}

function isFreeZenModel(modelId: string): boolean {
  return modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId);
}

function formatModelName(modelId: string): string {
  return modelId
    .split("-")
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
