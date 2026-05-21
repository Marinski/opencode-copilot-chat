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
  responsesUrl?: string;
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
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const OPEN_CODE_CLIENT = "vscode-copilot-chat";
const OPEN_CODE_USER_AGENT = "opencode-copilot-chat/0.1.6 VSCode";
// Bump this when we need to force VS Code picker metadata refresh.
const MODEL_METADATA_REVISION = "session-2026-05-21-b";

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
    responsesUrl: "https://opencode.ai/zen/v1/responses",
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
  configurationSchema?: vscode.LanguageModelConfigurationSchema;
}

interface ModelListEntry {
  id?: string;
  owned_by?: string;
  status?: string;
  deprecated?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  context_window?: number;
  contextWindow?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  attachment?: boolean;
  image_input?: boolean;
  imageInput?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

interface ModelListResponse {
  data?: ModelListEntry[];
}

interface ModelsDevModelRecord {
  status?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  attachment?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

interface ModelsDevProviderRecord {
  models?: Record<string, ModelsDevModelRecord>;
}

interface ModelsDevResponse {
  opencode?: ModelsDevProviderRecord;
  "opencode-go"?: ModelsDevProviderRecord;
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

interface ThinkingSettings {
  deepseek: "off" | "high" | "max";
  glm: "on" | "off";
  kimi: "on" | "off";
  qwen: "auto" | "on" | "off";
  qwenBudget: "auto" | "4096" | "16384" | "32768" | "81920";
}

interface ApiSettings {
  temperature: number;
  maxOutputTokensOverride: number;
  maxInputTokensOverride: number;
  debugReasoning: boolean;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  thinking: ThinkingSettings;
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

interface ModelMetadataFields {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  reasoning?: boolean;
  status?: string;
}

interface CachedModelMetadataSnapshot {
  fetchedAt: number;
  providers: Record<
    ProviderDefinition["vendor"],
    Record<string, ModelMetadataFields>
  >;
}

interface ResolvedModelMetadata extends BaseModelLimits {
  supportsVision: boolean;
  reasoning: boolean;
  status?: string;
  source: "models.dev" | "live" | "fallback" | "default";
}

// Copilot surfaces combine input/output metadata differently across views.
// Reserve a modest UI output budget, while requests still use the real model max.
const UI_OUTPUT_TOKEN_RESERVE = 8192;
const MODEL_METADATA_CACHE_KEY = "opencodego.modelMetadataCache.v3";
const MODEL_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_MODEL_LIMITS: BaseModelLimits = {
  contextWindow: 262144,
  maxOutputTokens: 65536
};

const MODELS_DEV_PROVIDER_BY_VENDOR: Record<
  ProviderDefinition["vendor"],
  keyof ModelsDevResponse
> = {
  [GO_VENDOR]: "opencode-go",
  [ZEN_VENDOR]: "opencode",
};

// Context limits sourced from models.dev (official OpenCode model registry).
// Keep limits per provider to avoid cross-provider contamination in VS Code's
// picker metadata cache.
const MODEL_LIMITS_BY_PROVIDER: Record<ProviderDefinition["vendor"], Record<string, BaseModelLimits>> = {
  [GO_VENDOR]: {
    "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "mimo-v2.5": { contextWindow: 1048576, maxOutputTokens: 131072 },
    "mimo-v2.5-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "mimo-v2-omni": { contextWindow: 262144, maxOutputTokens: 128000 },
    "mimo-v2-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "kimi-k2.6": { contextWindow: 262144, maxOutputTokens: 262144 },
    "kimi-k2.5": { contextWindow: 262144, maxOutputTokens: 65536 },
    "glm-5.1": { contextWindow: 200000, maxOutputTokens: 131072 },
    "glm-5": { contextWindow: 202752, maxOutputTokens: 202752 },
    "minimax-m2.7": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.5": { contextWindow: 204800, maxOutputTokens: 65536 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "hy3-preview": { contextWindow: 256000, maxOutputTokens: 64000 },
    "ring-2.6-1t": { contextWindow: 262000, maxOutputTokens: 66000 }
  },
  [ZEN_VENDOR]: {
    "deepseek-v4-flash-free": { contextWindow: 200000, maxOutputTokens: 128000 },
    "minimax-m2.5-free": { contextWindow: 204800, maxOutputTokens: 131072 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.6-plus-free": { contextWindow: 200000, maxOutputTokens: 128000 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "trinity-large-preview-free": { contextWindow: 131072, maxOutputTokens: 131072 },
    "nemotron-3-super-free": { contextWindow: 256000, maxOutputTokens: 256000 },
    "big-pickle": { contextWindow: 128000, maxOutputTokens: 64000 }
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
  "qwen3.6-plus-free": "Free relaunch with limited GPU capacity. Stable for short prompts; bursty traffic or very large tool catalogs may return 5xx - retry or fall back to 'deepseek-v4-flash-free' / 'big-pickle'. Paid 'qwen3.6-plus' has no quota."
};

let modelMetadataSnapshot: CachedModelMetadataSnapshot | undefined;
let modelMetadataRefreshPromise: Promise<CachedModelMetadataSnapshot> | undefined;

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
    vscode.commands.registerCommand("opencodezen.diagnostics", () => zenProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodego.modelPickerDiagnostics", () => showModelPickerDiagnostics()),
    vscode.commands.registerCommand("opencodego.setThinkingEffort", () => showThinkingEffortPicker())
  );

  void warmModelPickerMetadata();
}

async function warmModelPickerMetadata(): Promise<void> {
  await Promise.allSettled([
    vscode.lm.selectChatModels({ vendor: GO_VENDOR }),
    vscode.lm.selectChatModels({ vendor: ZEN_VENDOR })
  ]);
}

async function showModelPickerDiagnostics(): Promise<void> {
  const vendors = [GO_VENDOR, ZEN_VENDOR, "copilot"];
  const sections: string[] = [];

  for (const vendor of vendors) {
    const models = await vscode.lm.selectChatModels({ vendor });
    sections.push(`## vendor: ${vendor}`, "", `models: ${models.length}`, "");
    for (const model of models) {
      const internalModel = model as unknown as { configurationSchema?: unknown; detail?: unknown };
      const schema = internalModel.configurationSchema;
      sections.push(
        `### ${model.name}`,
        "",
        `- id: \`${model.id}\``,
        `- family: \`${model.family}\``,
        `- version: \`${model.version}\``,
        `- vendor: \`${model.vendor}\``,
        `- detail: \`${typeof internalModel.detail === "string" ? internalModel.detail : ""}\``,
        `- schema:`,
        "```json",
        JSON.stringify(schema ?? null, null, 2),
        "```",
        ""
      );
    }
  }

  const doc = await vscode.workspace.openTextDocument({
    content: ["# OpenCode Model Picker Diagnostics", "", ...sections].join("\n"),
    language: "markdown"
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function showThinkingEffortPicker(): Promise<void> {
  const families: { label: string; key: keyof ThinkingSettings; options: string[] }[] = [
    { label: "DeepSeek (deepseek-v4-*)", key: "deepseek", options: ["off", "high", "max"] },
    { label: "GLM (glm-5, glm-5.1)", key: "glm", options: ["on", "off"] },
    { label: "Kimi (kimi-k2.*)", key: "kimi", options: ["on", "off"] },
    { label: "Qwen (qwen3.*)", key: "qwen", options: ["auto", "on", "off"] },
    { label: "Qwen Thinking Budget", key: "qwenBudget", options: ["auto", "4096", "16384", "32768", "81920"] }
  ];
  const settings = getSettings().thinking;
  const family = await vscode.window.showQuickPick(
    families.map(f => ({ label: f.label, description: `current: ${settings[f.key]}`, family: f })),
    { placeHolder: "Pick a model family to configure Thinking" }
  );
  if (!family) return;
  const choice = await vscode.window.showQuickPick(family.family.options, {
    placeHolder: `Set ${family.family.label} → Thinking value`
  });
  if (!choice) return;
  const cfg = vscode.workspace.getConfiguration("opencodego.thinking");
  await cfg.update(family.family.key, choice, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`OpenCode Thinking — ${family.family.label}: ${choice}`);
}

export function deactivate() {
  // Nothing to clean up.
}

class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  private readonly apiKeysByModelId = new Map<string, string>();
  private readonly reasoningContentByToolCallId = new Map<string, string>();
  private readonly liveModelMetadataById = new Map<string, ModelMetadataFields>();
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

  private async getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot> {
    return getOpenCodeModelMetadata(this.context, this.getOutputChannel());
  }

  private resolveModelMetadata(
    modelId: string,
    snapshot: CachedModelMetadataSnapshot,
  ): ResolvedModelMetadata {
    const cachedMetadata = snapshot.providers[this.definition.vendor][modelId];
    const liveMetadata = this.liveModelMetadataById.get(modelId);
    const fallbackMetadata = fallbackModelMetadata(modelId, this.definition.vendor);

    return {
      contextWindow:
        liveMetadata?.contextWindow ??
        cachedMetadata?.contextWindow ??
        fallbackMetadata?.contextWindow ??
        DEFAULT_MODEL_LIMITS.contextWindow,
      maxOutputTokens:
        liveMetadata?.maxOutputTokens ??
        cachedMetadata?.maxOutputTokens ??
        fallbackMetadata?.maxOutputTokens ??
        DEFAULT_MODEL_LIMITS.maxOutputTokens,
      supportsVision:
        liveMetadata?.supportsVision ??
        cachedMetadata?.supportsVision ??
        fallbackMetadata?.supportsVision ??
        false,
      reasoning:
        liveMetadata?.reasoning ??
        cachedMetadata?.reasoning ??
        fallbackMetadata?.reasoning ??
        Boolean(thinkingFamily(modelId)),
      status:
        liveMetadata?.status ??
        cachedMetadata?.status ??
        fallbackMetadata?.status,
      source: liveMetadata
        ? "live"
        : cachedMetadata
          ? "models.dev"
          : fallbackMetadata
            ? "fallback"
            : "default",
    };
  }

  private replaceLiveModelMetadata(entries: ModelListEntry[] | undefined): void {
    this.liveModelMetadataById.clear();
    for (const entry of entries ?? []) {
      if (typeof entry.id !== "string" || !entry.id) {
        continue;
      }
      const metadata = normalizeLiveModelMetadata(entry);
      if (metadata) {
        this.liveModelMetadataById.set(entry.id, metadata);
      }
    }
  }

  private async refreshMetadataAndModels(): Promise<void> {
    await clearOpenCodeModelMetadataCache(this.context);
    await this.fetchModels();
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

    await this.refreshMetadataAndModels();
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
    const metadataSnapshot = await this.getMetadataSnapshot();
    const lines = models.map((model) => {
      const rawModelId = resolveRawModelId(model.id);
      const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
      const limits = modelLimits(metadata);
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
      `  metadataSource: ${metadata.source}`,
      `  supportsVision: ${metadata.supportsVision}`,
      `  status: ${metadata.status ?? "active"}`,
      `  thinkingFamily: ${thinkingFamily(rawModelId) ?? "none"}`,
      `  configurationSchema: ${JSON.stringify((model as unknown as { configurationSchema?: unknown }).configurationSchema ?? null)}`,
      ...(hasExplicitModelLimits(rawModelId, this.definition.vendor) ? [] : ["  limits: using bundled fallback"])
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
    const metadataSnapshot = await this.getMetadataSnapshot();

    return models.map((modelId) => {
      const metadata = this.resolveModelMetadata(modelId, metadataSnapshot);
      const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
      const limits = modelLimits(metadata, settings);
      this.apiKeysByModelId.set(modelId, apiKey);
      this.apiKeysByModelId.set(effectiveModelId, apiKey);

      const capacityNote = CAPACITY_LIMITED_MODEL_NOTES[modelId];
      const baseDetail = this.definition.vendor === ZEN_VENDOR && isFreeZenModel(modelId) ? "Free" : this.definition.displayName;
      const baseTooltip = `${this.definition.displayName} model: ${modelId}`;
      const configurationSchema = modelConfigurationSchema(modelId);

      const info: OpenCodeModel = {
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
        capabilities: modelCapabilities(metadata),
        endpointKind: modelEndpointKind(modelId, this.definition),
        provider: this.definition,
        // Inline so Copilot Chat picks up the Thinking submenu directly
        // (parity with zelosleone/Opencode-Go-For-Copilot pattern).
        ...(configurationSchema ? { configurationSchema } : {})
      };

      this.log(`Model registered: id=${info.id} family=${info.family} metadataSource=${metadata.source} configurationSchema=${configurationSchema ? JSON.stringify(configurationSchema) : "none"}`);

      return info;
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
    const baseSettings = getSettings();
    const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
    // Apply per-request Thinking selection (from Copilot Chat submenu) on top
    // of the workspace default. The override only affects the current model
    // family; other families remain at their global defaults.
    const requestOverride = getRequestModelConfiguration(options);
    const settings: ApiSettings = {
      ...baseSettings,
      thinking: applyRequestThinkingOverride(rawModelId, baseSettings.thinking, requestOverride)
    };
    const metadataSnapshot = await this.getMetadataSnapshot();
    const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
    const limits = modelLimits(metadata, settings);
    const thinkingPayload = buildThinkingPayload(rawModelId, settings.thinking);
    const requestHeaders = buildOpenCodeRequestHeaders(
      messages,
      options,
      rawModelId,
    );

    this.log(`Request: model=${model.id} rawModel=${rawModelId} endpoint=${model.endpointKind} metadataSource=${metadata.source} messages=${apiMessages.length} session=${requestHeaders["x-opencode-session"]} request=${requestHeaders["x-opencode-request"]} modelConfiguration=${JSON.stringify(pickThinkingModelConfiguration(requestOverride))} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`);
    if (settings.debugReasoning) {
      this.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
    }

    try {
      if (model.endpointKind === "messages") {
        await streamAnthropicMessages(this.definition.messagesUrl, this.definition.displayName, apiKey, rawModelId, apiMessages, options, settings, limits, requestHeaders, progress, token, this.getOutputChannel());
        return;
      }

      if (isQwenModel(rawModelId)) {
        await streamChatCompletionsWithAnthropicStream(
          this.definition.chatCompletionsUrl,
          this.definition.displayName,
          apiKey,
          rawModelId,
          apiMessages,
          options,
          settings,
          limits,
          requestHeaders,
          progress,
          token,
          this.getOutputChannel()
        );
        this.log(`Request completed: model=${model.id}`);
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
        requestHeaders,
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
      if (error instanceof OpenCodeRequestError) {
        vscode.window.showErrorMessage(error.userMessage);
      }
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
      this.replaceLiveModelMetadata(data.data);
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
      const metadataSnapshot = await this.getMetadataSnapshot();
      const filteredModelIds = uniqueModelIds.filter((modelId) =>
        !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId)
        && !shouldHideDeprecatedModel(modelId, this.definition.vendor, metadataSnapshot)
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

function isFreshModelMetadata(snapshot: CachedModelMetadataSnapshot): boolean {
  return Date.now() - snapshot.fetchedAt < MODEL_METADATA_CACHE_TTL_MS;
}

async function clearOpenCodeModelMetadataCache(
  context: vscode.ExtensionContext,
): Promise<void> {
  modelMetadataSnapshot = undefined;
  modelMetadataRefreshPromise = undefined;
  await context.globalState.update(MODEL_METADATA_CACHE_KEY, undefined);
}

async function getOpenCodeModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  const cached =
    modelMetadataSnapshot ??
    context.globalState.get<CachedModelMetadataSnapshot>(
      MODEL_METADATA_CACHE_KEY,
    );
  if (cached) {
    modelMetadataSnapshot = cached;
    if (isFreshModelMetadata(cached)) {
      return cached;
    }
    void refreshOpenCodeModelMetadata(context, output);
    return cached;
  }

  return refreshOpenCodeModelMetadata(context, output);
}

async function refreshOpenCodeModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  if (modelMetadataRefreshPromise) {
    return modelMetadataRefreshPromise;
  }

  modelMetadataRefreshPromise = (async () => {
    const response = await fetch(MODELS_DEV_API_URL);

    if (!response.ok) {
      throw new Error(`models.dev request failed (${response.status}): ${response.statusText}`);
    }

    const data = await response.json() as ModelsDevResponse;
    const snapshot = normalizeModelsDevSnapshot(data);
    modelMetadataSnapshot = snapshot;
    await context.globalState.update(MODEL_METADATA_CACHE_KEY, snapshot);
    output?.appendLine(
      `[metadata] refreshed models.dev cache go=${Object.keys(snapshot.providers[GO_VENDOR]).length} zen=${Object.keys(snapshot.providers[ZEN_VENDOR]).length}`,
    );
    return snapshot;
  })()
    .catch((error) => {
      const cached =
        modelMetadataSnapshot ??
        context.globalState.get<CachedModelMetadataSnapshot>(
          MODEL_METADATA_CACHE_KEY,
        );
      if (cached) {
        const message = error instanceof Error ? error.message : String(error);
        output?.appendLine(
          `[metadata] refresh failed, using cached snapshot: ${message}`,
        );
        modelMetadataSnapshot = cached;
        return cached;
      }

      const message = error instanceof Error ? error.message : String(error);
      const fallback = bundledModelMetadataSnapshot();
      output?.appendLine(
        `[metadata] refresh failed, using bundled snapshot: ${message}`,
      );
      modelMetadataSnapshot = fallback;
      return fallback;
    })
    .finally(() => {
      modelMetadataRefreshPromise = undefined;
    });

  return modelMetadataRefreshPromise;
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
  requestHeaders: Record<string, string>,
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

  // Per-family Thinking controls. Replaces the previous hard-coded Qwen patch.
  // Default Qwen config is `off`, which preserves the prior behavior of
  // explicitly disabling hybrid thinking to avoid empty Copilot replies.
  const thinkingPayload = buildThinkingPayload(modelId, settings.thinking);

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
      ...thinkingPayload,
      ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {})
    },
    requestHeaders,
    progress,
    token,
    (data) => extractor.extractStreamParts(data),
    extractChatCompletionParts,
    output,
    settings.debugReasoning,
    settings.requestTimeoutMs,
    settings.streamIdleTimeoutMs,
  );

  extractor.flushReasoningFallback(progress);
  output.appendLine(`[stream-summary model=${modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`);
  if (extractor.emittedText === 0 && extractor.emittedTools === 0) {
    output.appendLine(`[warn] empty response from model=${modelId} (no text, no tool calls, no reasoning). Try a different free model or enable opencodego.debugReasoning to inspect raw SSE.`);
    output.show(true);
  }
}

async function streamChatCompletionsWithAnthropicStream(
  url: string,
  providerDisplayName: string,
  apiKey: string,
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  limits: ModelLimits,
  requestHeaders: Record<string, string>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  output: vscode.OutputChannel
): Promise<void> {
  const openAiExtractor = new OpenAiResponseExtractor(undefined, (reasoningContent) => {
    if (settings.debugReasoning) {
      output.appendLine("[reasoning_content]");
      output.appendLine(reasoningContent);
      output.appendLine("[/reasoning_content]");
    }
  });
  const tools = mapOpenAiTools(options.tools);
  const anthropicExtractor = new AnthropicResponseExtractor();
  const thinkingPayload = buildThinkingPayload(modelId, settings.thinking);

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
      ...thinkingPayload,
      ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {})
    },
    requestHeaders,
    progress,
    token,
    (data) => {
      const openAiParts = openAiExtractor.extractStreamParts(data);
      return openAiParts.length ? openAiParts : anthropicExtractor.extractStreamParts(data);
    },
    (data) => {
      const openAiParts = extractChatCompletionParts(data);
      return openAiParts.length ? openAiParts : extractAnthropicParts(data);
    },
    output,
    settings.debugReasoning,
    settings.requestTimeoutMs,
    settings.streamIdleTimeoutMs,
  );

  openAiExtractor.flushReasoningFallback(progress);
  const emittedText = openAiExtractor.emittedText + anthropicExtractor.emittedText;
  output.appendLine(`[stream-summary model=${modelId}] textChars=${emittedText} toolCalls=${openAiExtractor.emittedTools} reasoningChars=${openAiExtractor.reasoningChars}`);
  if (emittedText === 0 && openAiExtractor.emittedTools === 0) {
    output.appendLine(`[warn] empty response from model=${modelId} after hybrid Qwen stream parsing. Enable opencodego.debugReasoning to inspect raw SSE.`);
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
  requestHeaders: Record<string, string>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  output?: vscode.OutputChannel
): Promise<void> {
  const tools = mapAnthropicTools(options.tools);
  const extractor = new AnthropicResponseExtractor();
  // Qwen3.x routes through the /messages endpoint but still accepts the
  // OpenAI-style enable_thinking / thinking_budget flags via the OpenCode
  // gateway. Apply the same per-family Thinking payload here so the picker
  // setting works regardless of which endpoint a model is routed to.
  const thinkingPayload = buildThinkingPayload(modelId, settings.thinking);

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
      ...thinkingPayload,
      ...(tools.length ? { tools, tool_choice: anthropicToolChoice(options.toolMode) } : {})
    },
    requestHeaders,
    progress,
    token,
    (data) => extractor.extractStreamParts(data),
    extractAnthropicParts,
    output,
    settings.debugReasoning,
    settings.requestTimeoutMs,
    settings.streamIdleTimeoutMs,
  );
}

// The official OpenCode client sends these headers on every request. The Zen
// gateway reads x-opencode-session first, then converts that sticky identifier
// into provider-specific affinity headers such as x-session-affinity upstream.
//
// VS Code's provider API does not currently expose a guaranteed public session
// identifier everywhere, so we first probe a few known internal fields and then
// fall back to a stable hash of the first messages in the conversation. That
// preserves sticky routing and cache affinity without depending on hidden state.
function buildOpenCodeRequestHeaders(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  modelId: string,
): Record<string, string> {
  const sessionId = cleanHeaderValue(
    findStringOption(options, [
      "sessionId",
      "sessionID",
      "chatSessionId",
      "chatSessionID",
      "conversationId",
      "conversationID",
      "threadId",
      "threadID",
      "session.id",
      "chatSession.id",
    ]) ?? `vscode-${stableHash(conversationAnchor(messages, modelId))}`,
  );
  const requestId = cleanHeaderValue(
    findStringOption(options, [
      "requestId",
      "requestID",
      "messageId",
      "messageID",
    ]) ??
      `req-${stableHash(`${Date.now()}-${Math.random()}-${sessionId}-${modelId}`)}`,
  );

  return {
    "x-opencode-session": sessionId,
    "x-opencode-request": requestId,
    "x-opencode-client": OPEN_CODE_CLIENT,
    "User-Agent": OPEN_CODE_USER_AGENT,
  };
}

function findStringOption(
  options: unknown,
  paths: string[],
): string | undefined {
  for (const path of paths) {
    const value = readPath(options, path.split("."));
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function conversationAnchor(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  modelId: string,
): string {
  const anchorMessages = messages
    .slice(0, 3)
    .map((message) => `${message.role}:${messageText(message).slice(0, 2048)}`);
  return anchorMessages.length ? anchorMessages.join("\n") : modelId;
}

function cleanHeaderValue(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  return cleaned ? cleaned.slice(0, 256) : "unknown";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function mapOpenAiTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): OpenAiToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeToolSchema(tool.inputSchema)
    }
  }));
}

function mapAnthropicTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): AnthropicToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeToolSchema(tool.inputSchema)
  }));
}

function sanitizeToolSchema(schema: unknown): object {
  const root = isRecord(schema) ? schema : { type: "object", properties: {} };
  const sanitized = sanitizeJsonSchemaNode(root, root, new Set());
  if (!isRecord(sanitized)) {
    return { type: "object", properties: {} };
  }

  return {
    type: sanitized.type === "object" ? "object" : "object",
    properties: isRecord(sanitized.properties) ? sanitized.properties : {},
    ...(Array.isArray(sanitized.required) ? { required: sanitized.required } : {})
  };
}

function sanitizeJsonSchemaNode(value: unknown, root: Record<string, unknown>, seenRefs: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs));
  }

  if (!isRecord(value)) {
    return value;
  }

  const ref = typeof value.$ref === "string" ? value.$ref : undefined;
  if (ref?.startsWith("#/") && !seenRefs.has(ref)) {
    const target = resolveJsonPointer(root, ref);
    if (target !== undefined) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(ref);
      const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
      const resolved = sanitizeJsonSchemaNode(target, root, nextSeenRefs);
      return isRecord(resolved)
        ? sanitizeJsonSchemaNode({ ...resolved, ...siblings }, root, nextSeenRefs)
        : sanitizeJsonSchemaNode(siblings, root, nextSeenRefs);
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "$id" || key === "$ref" || key === "$defs" || key === "definitions") {
      continue;
    }

    if (key === "properties" && isRecord(child)) {
      result.properties = Object.fromEntries(
        Object.entries(child).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeJsonSchemaNode(propertySchema, root, seenRefs)
        ])
      );
      continue;
    }

    if (key === "items" || key === "additionalProperties") {
      result[key] = sanitizeJsonSchemaNode(child, root, seenRefs);
      continue;
    }

    if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(child)) {
      result[key] = child.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs));
      continue;
    }

    if (["type", "description", "enum", "required", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key)) {
      result[key] = child;
    }
  }

  return result;
}

function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  return pointer
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
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
  requestHeaders: Record<string, string>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  extractStreamParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  extractFullParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  output?: vscode.OutputChannel,
  verbose: boolean = false,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  streamIdleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  let abortReason:
    | "request-timeout"
    | "stream-idle-timeout"
    | "cancelled"
    | undefined;
  const abort = (reason: typeof abortReason) => {
    abortReason ??= reason;
    controller.abort();
  };
  const cancellation = token.onCancellationRequested(() => abort("cancelled"));
  const requestTimeout = setTimeout(
    () => abort("request-timeout"),
    requestTimeoutMs,
  );
  let streamIdleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetStreamIdleTimeout = () => {
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    streamIdleTimeout = setTimeout(
      () => abort("stream-idle-timeout"),
      streamIdleTimeoutMs,
    );
  };

  try {
    const payload = JSON.stringify(body);
    output?.appendLine(`[request] url=${url} payloadBytes=${payload.length} requestTimeoutMs=${requestTimeoutMs} streamIdleTimeoutMs=${streamIdleTimeoutMs}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...requestHeaders,
      },
      body: payload,
      signal: controller.signal
    });

    output?.appendLine(`[http] ${response.status} ${response.statusText} content-type=${response.headers.get("content-type") ?? "<none>"}`);
    const rateLimitSummary = formatRateLimitSummary(
      readRateLimitInfo(response.headers),
    );
    if (rateLimitSummary) {
      output?.appendLine(`[rate-limit] ${rateLimitSummary}`);
    }

    if (!response.ok) {
      const detail = await response.text();
      const modelId = (isRecord(body) && typeof (body as { model?: unknown }).model === "string") ? (body as { model: string }).model : undefined;
      const capacityHint = (modelId && CAPACITY_LIMITED_MODEL_NOTES[modelId] && response.status >= 500) ? ` — ${CAPACITY_LIMITED_MODEL_NOTES[modelId]}` : "";
      throw buildOpenCodeRequestError(
        providerDisplayName,
        response,
        detail,
        modelId,
        payload.length,
        capacityHint,
      );
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
    resetStreamIdleTimeout();

    while (!token.isCancellationRequested) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      resetStreamIdleTimeout();

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
  } catch (error) {
    if (abortReason === "cancelled") {
      return;
    }
    if (abortReason === "request-timeout") {
      throw new OpenCodeRequestError(
        `${providerDisplayName} request timed out after ${formatDuration(requestTimeoutMs)}.`,
        `${providerDisplayName} did not start or finish the request within ${formatDuration(requestTimeoutMs)}. Try again later or reduce the request size.`,
      );
    }
    if (abortReason === "stream-idle-timeout") {
      throw new OpenCodeRequestError(
        `${providerDisplayName} stream stalled for ${formatDuration(streamIdleTimeoutMs)} without new data.`,
        `${providerDisplayName} stopped sending stream data for ${formatDuration(streamIdleTimeoutMs)}, so the request was cancelled to avoid leaving Copilot stuck.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(requestTimeout);
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    cancellation.dispose();
  }
}

class OpenCodeRequestError extends Error {
  constructor(
    message: string,
    readonly userMessage: string = message,
  ) {
    super(message);
    this.name = "OpenCodeRequestError";
  }
}

interface ParsedApiError {
  message?: string;
  code?: string;
  type?: string;
  retryIn?: string;
}

interface RateLimitInfo {
  retryAfterMs?: number;
  resetAfterMs?: number;
  requestLimit?: string;
  requestRemaining?: string;
  tokenLimit?: string;
  tokenRemaining?: string;
}

function buildOpenCodeRequestError(
  providerDisplayName: string,
  response: Response,
  rawDetail: string,
  modelId: string | undefined,
  payloadBytes: number,
  capacityHint: string,
): OpenCodeRequestError {
  const apiError = parseApiError(rawDetail);
  const rateLimitInfo = readRateLimitInfo(response.headers);
  const modelHint = modelId ? ` model=${modelId}` : "";
  const sizeHint = ` payloadBytes=${payloadBytes}`;
  const apiMessage =
    (apiError.message ?? rawDetail.trim()) || response.statusText;
  const isLimit = isRateLimitResponse(response.status, apiError);

  if (isLimit) {
    const waitText =
      apiError.retryIn ??
      formatWaitText(rateLimitInfo.retryAfterMs ?? rateLimitInfo.resetAfterMs);
    const quotaText = formatRateLimitSummary(rateLimitInfo);
    const reason = classifyRateLimit(apiError, response.status);
    const details = [
      shouldIncludeApiMessage(apiMessage, reason) ? apiMessage : undefined,
      waitText ? `Retry after ${waitText}.` : undefined,
      quotaText ? `Quota: ${quotaText}.` : undefined,
    ].filter((part): part is string => Boolean(part));
    const userMessage =
      `${providerDisplayName}: ${reason}${modelHint ? ` (${modelId})` : ""}. ${details.join(" ")}`.trim();
    return new OpenCodeRequestError(
      `${providerDisplayName} API rate/quota limit (${response.status})${modelHint}${sizeHint}: ${apiMessage}; ${quotaText || "no quota headers"}`,
      userMessage,
    );
  }

  const userMessage = `${providerDisplayName} API request failed (HTTP ${response.status})${modelHint ? ` for ${modelId}` : ""}: ${apiMessage}${capacityHint}`;
  return new OpenCodeRequestError(
    `${providerDisplayName} API request failed (${response.status})${modelHint}${sizeHint}${capacityHint}: ${apiMessage}`,
    userMessage,
  );
}

function parseApiError(rawDetail: string): ParsedApiError {
  const fallback = rawDetail.trim();
  if (!fallback) {
    return {};
  }

  try {
    const parsed = JSON.parse(fallback) as unknown;
    if (!isRecord(parsed)) {
      return { message: fallback };
    }

    const error = isRecord(parsed.error) ? parsed.error : parsed;
    return {
      message: firstString(error.message, parsed.message, fallback),
      code: firstString(error.code, parsed.code),
      type: firstString(error.type, parsed.type),
      retryIn: firstString(
        error.retryIn,
        parsed.retryIn,
        error.retry_in,
        parsed.retry_in,
      ),
    };
  } catch {
    return { message: fallback };
  }
}

function readRateLimitInfo(headers: Headers): RateLimitInfo {
  const retryAfter = firstHeader(headers, ["retry-after"]);
  const requestLimit = firstHeader(headers, [
    "x-ratelimit-limit-requests",
    "anthropic-ratelimit-requests-limit",
    "x-ratelimit-limit",
    "ratelimit-limit",
  ]);
  const requestRemaining = firstHeader(headers, [
    "x-ratelimit-remaining-requests",
    "anthropic-ratelimit-requests-remaining",
    "x-ratelimit-remaining",
    "ratelimit-remaining",
  ]);
  const tokenLimit = firstHeader(headers, [
    "x-ratelimit-limit-tokens",
    "anthropic-ratelimit-tokens-limit",
  ]);
  const tokenRemaining = firstHeader(headers, [
    "x-ratelimit-remaining-tokens",
    "anthropic-ratelimit-tokens-remaining",
  ]);
  const reset = firstHeader(headers, [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-reset",
    "x-ratelimit-reset",
    "ratelimit-reset",
  ]);

  return {
    retryAfterMs: parseRetryAfter(retryAfter),
    resetAfterMs: parseResetAfter(reset),
    requestLimit,
    requestRemaining,
    tokenLimit,
    tokenRemaining,
  };
}

function formatRateLimitSummary(info: RateLimitInfo): string | undefined {
  const parts = [
    info.requestRemaining || info.requestLimit
      ? `requests remaining=${info.requestRemaining ?? "?"}${info.requestLimit ? `/${info.requestLimit}` : ""}`
      : undefined,
    info.tokenRemaining || info.tokenLimit
      ? `tokens remaining=${info.tokenRemaining ?? "?"}${info.tokenLimit ? `/${info.tokenLimit}` : ""}`
      : undefined,
    info.retryAfterMs !== undefined
      ? `retry-after=${formatDuration(info.retryAfterMs)}`
      : undefined,
    info.resetAfterMs !== undefined
      ? `reset=${formatDuration(info.resetAfterMs)}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join("; ") : undefined;
}

function classifyRateLimit(apiError: ParsedApiError, status: number): string {
  const code =
    `${apiError.code ?? ""} ${apiError.type ?? ""} ${apiError.message ?? ""}`.toLowerCase();
  const compactCode = compactErrorCode(code);
  if (compactCode.includes("gosubscriptionrollinglimitexceeded")) {
    return "5-hour OpenCode Go usage limit reached";
  }
  if (compactCode.includes("gosubscriptionweeklylimitexceeded")) {
    return "weekly OpenCode Go usage limit reached";
  }
  if (compactCode.includes("gosubscriptionmonthlylimitexceeded")) {
    return "monthly OpenCode Go usage limit reached";
  }
  if (code.includes("subscriptionquota") || code.includes("quota")) {
    return "OpenCode quota exceeded";
  }
  return status === 429
    ? "rate limit exceeded"
    : "OpenCode usage limit reached";
}

function isRateLimitResponse(
  status: number,
  apiError: ParsedApiError,
): boolean {
  const code =
    `${apiError.code ?? ""} ${apiError.type ?? ""} ${apiError.message ?? ""}`.toLowerCase();
  const compactCode = compactErrorCode(code);
  return (
    status === 429 ||
    compactCode.includes("ratelimit") ||
    code.includes("rate_limit") ||
    code.includes("quota") ||
    compactCode.includes("limitexceeded")
  );
}

function compactErrorCode(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function shouldIncludeApiMessage(apiMessage: string, reason: string): boolean {
  const normalizedMessage = compactErrorCode(apiMessage.toLowerCase());
  const normalizedReason = compactErrorCode(reason.toLowerCase());
  return (
    Boolean(normalizedMessage) &&
    !normalizedMessage.startsWith(normalizedReason)
  );
}

function firstHeader(headers: Headers, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs)
    ? Math.max(0, dateMs - Date.now())
    : parseDurationLike(value);
}

function parseResetAfter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > 1_000_000_000_000) {
      return Math.max(0, numeric - Date.now());
    }
    if (numeric > 1_000_000_000) {
      return Math.max(0, numeric * 1000 - Date.now());
    }
    return numeric * 1000;
  }
  const durationMs = parseDurationLike(value);
  if (durationMs !== undefined) {
    return durationMs;
  }
  return parseRetryAfter(value);
}

function parseDurationLike(value: string): number | undefined {
  const matches = value
    .trim()
    .toLowerCase()
    .matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g);
  let totalMs = 0;
  let found = false;
  for (const match of matches) {
    found = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) {
      continue;
    }
    if (unit === "ms") {
      totalMs += amount;
    } else if (unit === "s") {
      totalMs += amount * 1000;
    } else if (unit === "m") {
      totalMs += amount * 60 * 1000;
    } else if (unit === "h") {
      totalMs += amount * 60 * 60 * 1000;
    }
  }
  return found ? Math.max(0, Math.ceil(totalMs)) : undefined;
}

function formatWaitText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatDuration(value);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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
  private emittedTextLength = 0;

  get emittedText(): number { return this.emittedTextLength; }

  extractStreamParts(data: unknown): vscode.LanguageModelResponsePart[] {
    if (!isRecord(data)) {
      return [];
    }

    const delta = data.delta;
    if (isRecord(delta) && typeof delta.text === "string") {
      this.emittedTextLength += delta.text.length;
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

// Detect which Thinking family a raw model id belongs to. Used both to render
// the per-model picker submenu (configurationSchema) and to map the user's
// per-request selection back to the right OpenCode request field.
type ThinkingFamily = "deepseek" | "glm" | "kimi" | "qwen" | null;
function thinkingFamily(modelId: string): ThinkingFamily {
  if (/^deepseek-/i.test(modelId)) return "deepseek";
  if (/^glm-/i.test(modelId)) return "glm";
  if (/^kimi-/i.test(modelId)) return "kimi";
  if (/^qwen3(?:\.|-)/i.test(modelId)) return "qwen";
  return null;
}

// Per-family JSON-Schema describing the native model-picker controls rendered
// by VS Code 1.120. Keep the primary property name aligned with VS Code's
// BYOK reasoning control so builds with narrower assumptions still recognize it.
function modelConfigurationSchema(modelId: string): vscode.LanguageModelConfigurationSchema | undefined {
  const family = thinkingFamily(modelId);
  if (!family) return undefined;

  if (family === "deepseek") {
    return {
      type: "object",
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "high", "max"],
          enumItemLabels: ["Off", "High", "Max"],
          enumDescriptions: [
            "Fastest responses",
            "More reasoning",
            "Maximum reasoning"
          ],
          default: "off",
          group: "navigation"
        }
      }
    };
  }

  if (family === "glm" || family === "kimi") {
    return {
      type: "object",
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "on"],
          enumItemLabels: ["Off", "On"],
          enumDescriptions: [
            "Fastest responses",
            "Enable thinking"
          ],
          default: "off",
          group: "navigation"
        }
      }
    };
  }

  // qwen
  return {
    type: "object",
    properties: {
      reasoningEffort: {
        type: "string",
        title: "Thinking Effort",
        enum: ["off", "auto", "on"],
        enumItemLabels: ["Off", "Auto", "On"],
        enumDescriptions: [
          "Fastest responses",
          "Model decides",
          "Enable thinking"
        ],
        default: "off",
        group: "navigation"
      },
      thinkingBudget: {
        type: "string",
        title: "Thinking Budget",
        enum: ["auto", "4096", "16384", "32768", "81920"],
        enumItemLabels: ["Auto", "4K", "16K", "32K", "80K"],
        enumDescriptions: [
          "Provider default",
          "Small budget",
          "Medium budget",
          "Large budget",
          "Maximum budget"
        ],
        default: "auto"
      }
    }
  };
}

// Merge per-request modelConfiguration (from the Copilot Chat submenu) onto
// the global ThinkingSettings, so the picker selection wins over the workspace
// default. Only the field for the model's own family is touched.
function applyRequestThinkingOverride(
  modelId: string,
  base: ThinkingSettings,
  override: Record<string, unknown> | undefined
): ThinkingSettings {
  if (!override) return base;
  const family = thinkingFamily(modelId);
  if (!family) return base;

  const next: ThinkingSettings = { ...base };
  const reasoningEffort = override.reasoningEffort;
  const thinkingMode = override.thinkingMode;
  const thinkingBudget = override.thinkingBudget;

  if (family === "deepseek" && typeof reasoningEffort === "string") {
    if (reasoningEffort === "off" || reasoningEffort === "high" || reasoningEffort === "max") {
      next.deepseek = reasoningEffort;
    }
  }
  if (family === "glm" && typeof thinkingMode === "string") {
    if (thinkingMode === "on" || thinkingMode === "off") next.glm = thinkingMode;
  }
  if (family === "glm" && typeof reasoningEffort === "string") {
    if (reasoningEffort === "on" || reasoningEffort === "off") next.glm = reasoningEffort;
  }
  if (family === "kimi" && typeof thinkingMode === "string") {
    if (thinkingMode === "on" || thinkingMode === "off") next.kimi = thinkingMode;
  }
  if (family === "kimi" && typeof reasoningEffort === "string") {
    if (reasoningEffort === "on" || reasoningEffort === "off") next.kimi = reasoningEffort;
  }
  if (family === "qwen") {
    if (typeof thinkingMode === "string" && (thinkingMode === "auto" || thinkingMode === "on" || thinkingMode === "off")) {
      next.qwen = thinkingMode;
    }
    if (typeof reasoningEffort === "string" && (reasoningEffort === "auto" || reasoningEffort === "on" || reasoningEffort === "off")) {
      next.qwen = reasoningEffort;
    }
    if (typeof thinkingBudget === "string" && ["auto", "4096", "16384", "32768", "81920"].includes(thinkingBudget)) {
      next.qwenBudget = thinkingBudget as ThinkingSettings["qwenBudget"];
    }
  }
  return next;
}

function getRequestModelConfiguration(options: vscode.ProvideLanguageModelChatResponseOptions): Record<string, unknown> | undefined {
  // The field is `modelConfiguration` in the current proposed API; older
  // builds shipped it under `configuration` alongside the auth config. Accept
  // both shapes defensively so the picker keeps working across VS Code
  // versions.
  const opts = options as vscode.ProvideLanguageModelChatResponseOptions & {
    modelConfiguration?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
  };
  return opts.modelConfiguration ?? opts.configuration;
}

function pickThinkingModelConfiguration(override: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!override) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of ["reasoningEffort", "thinkingMode", "thinkingBudget"]) {
    const value = override[key];
    if (typeof value === "string") {
      picked[key] = value;
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}

function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration("opencodego");

  return {
    temperature: config.get("temperature", 0.2),
    maxOutputTokensOverride: config.get("maxTokens", 0),
    maxInputTokensOverride: config.get("maxInputTokens", 0),
    debugReasoning: config.get("debugReasoning", false),
    requestTimeoutMs:
      Math.max(config.get("requestTimeoutSeconds", DEFAULT_REQUEST_TIMEOUT_MS / 1000), 1) * 1000,
    streamIdleTimeoutMs:
      Math.max(
        config.get(
          "streamIdleTimeoutSeconds",
          DEFAULT_STREAM_IDLE_TIMEOUT_MS / 1000,
        ),
        1,
      ) * 1000,
    thinking: {
      deepseek: config.get<ThinkingSettings["deepseek"]>("thinking.deepseek", "off"),
      glm: config.get<ThinkingSettings["glm"]>("thinking.glm", "off"),
      kimi: config.get<ThinkingSettings["kimi"]>("thinking.kimi", "off"),
      qwen: config.get<ThinkingSettings["qwen"]>("thinking.qwen", "off"),
      qwenBudget: config.get<ThinkingSettings["qwenBudget"]>("thinking.qwenBudget", "auto")
    }
  };
}

// Maps the per-family Thinking settings to the request fields each OpenCode
// model family expects. Returns an object to spread into the request body.
// Anything returned here is merged into the OpenAI- or Anthropic-style payload.
function buildThinkingPayload(modelId: string, thinking: ThinkingSettings): Record<string, unknown> {
  if (/^deepseek-/i.test(modelId)) {
    if (thinking.deepseek === "off") {
      return {};
    }
    return { reasoning_effort: thinking.deepseek };
  }

  if (/^glm-/i.test(modelId)) {
    return { thinking: { type: thinking.glm === "on" ? "enabled" : "disabled" } };
  }

  if (/^kimi-/i.test(modelId)) {
    return { thinking: { type: thinking.kimi === "on" ? "enabled" : "disabled" } };
  }

  if (/^qwen3(?:\.|-)/i.test(modelId)) {
    if (thinking.qwen === "auto") {
      // Let the model decide; don't send enable_thinking. Budget is only
      // meaningful when thinking is active, so honor it here as well.
      return thinking.qwenBudget === "auto"
        ? {}
        : { thinking_budget: Number(thinking.qwenBudget) };
    }
    if (thinking.qwen === "on") {
      return thinking.qwenBudget === "auto"
        ? { enable_thinking: true }
        : { enable_thinking: true, thinking_budget: Number(thinking.qwenBudget) };
    }
    return { enable_thinking: false };
  }

  return {};
}

function isQwenModel(modelId: string): boolean {
  return /^qwen3(?:\.|-)/i.test(modelId);
}

function modelLimits(
  metadata: ResolvedModelMetadata,
  settings = getSettings(),
): ModelLimits {
  const contextWindow = positiveOverride(settings.maxInputTokensOverride) ?? metadata.contextWindow;
  const maxOutputTokens = positiveOverride(settings.maxOutputTokensOverride) ?? metadata.maxOutputTokens;
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

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function modelCapabilities(metadata: ResolvedModelMetadata): CopilotCompatibleCapabilities {
  const supportsVision = metadata.supportsVision;
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

  return "chat-completions";
}

function toEffectiveModelId(modelId: string, vendor: ProviderDefinition["vendor"]): string {
  return `${vendor}:${modelId}::${MODEL_METADATA_REVISION}`;
}

function bundledModelMetadataSnapshot(): CachedModelMetadataSnapshot {
  return {
    fetchedAt: 0,
    providers: {
      [GO_VENDOR]: bundledModelMetadataForProvider(GO_VENDOR),
      [ZEN_VENDOR]: bundledModelMetadataForProvider(ZEN_VENDOR),
    },
  };
}

function bundledModelMetadataForProvider(
  vendor: ProviderDefinition["vendor"],
): Record<string, ModelMetadataFields> {
  return Object.fromEntries(
    Object.keys(MODEL_LIMITS_BY_PROVIDER[vendor]).flatMap((modelId) => {
      const metadata = fallbackModelMetadata(modelId, vendor);
      return metadata ? [[modelId, metadata] as const] : [];
    }),
  );
}

function fallbackModelMetadata(
  modelId: string,
  vendor: ProviderDefinition["vendor"],
): ModelMetadataFields | undefined {
  const limits = MODEL_LIMITS_BY_PROVIDER[vendor][modelId];
  const supportsVision = VISION_CAPABLE_MODELS.has(modelId);
  const status =
    vendor === ZEN_VENDOR && modelId === "minimax-m2.5-free"
      ? "deprecated"
      : undefined;

  if (!limits && !supportsVision && !status && !thinkingFamily(modelId)) {
    return undefined;
  }

  return {
    contextWindow: limits?.contextWindow,
    maxOutputTokens: limits?.maxOutputTokens,
    supportsVision: supportsVision || undefined,
    reasoning: Boolean(thinkingFamily(modelId)) || undefined,
    status,
  };
}

function normalizeModelsDevSnapshot(
  data: ModelsDevResponse,
): CachedModelMetadataSnapshot {
  return {
    fetchedAt: Date.now(),
    providers: {
      [GO_VENDOR]: normalizeModelsDevProvider(
        data[MODELS_DEV_PROVIDER_BY_VENDOR[GO_VENDOR]]?.models ?? {},
      ),
      [ZEN_VENDOR]: normalizeModelsDevProvider(
        data[MODELS_DEV_PROVIDER_BY_VENDOR[ZEN_VENDOR]]?.models ?? {},
      ),
    },
  };
}

function normalizeModelsDevProvider(
  models: Record<string, ModelsDevModelRecord>,
): Record<string, ModelMetadataFields> {
  const normalized: Record<string, ModelMetadataFields> = {};

  for (const [modelId, model] of Object.entries(models)) {
    const metadata = normalizeModelMetadataFields({
      contextWindow: positiveNumber(model.limit?.context),
      maxOutputTokens: positiveNumber(model.limit?.output),
      supportsVision: detectVisionSupport(model.modalities, model.attachment),
      reasoning:
        typeof model.reasoning === "boolean" ? model.reasoning : undefined,
      status: typeof model.status === "string" ? model.status : undefined,
    });

    if (metadata) {
      normalized[modelId] = metadata;
    }
  }

  return normalized;
}

function normalizeLiveModelMetadata(
  model: ModelListEntry,
): ModelMetadataFields | undefined {
  return normalizeModelMetadataFields({
    contextWindow: positiveNumber(
      model.contextWindow ?? model.context_window ?? model.limit?.context,
    ),
    maxOutputTokens: positiveNumber(
      model.maxOutputTokens ?? model.max_output_tokens ?? model.limit?.output,
    ),
    supportsVision: detectVisionSupport(
      model.modalities,
      model.imageInput ?? model.image_input ?? model.attachment,
    ),
    reasoning:
      typeof model.reasoning === "boolean" ? model.reasoning : undefined,
    status: model.deprecated
      ? "deprecated"
      : typeof model.status === "string"
        ? model.status
        : undefined,
  });
}

function normalizeModelMetadataFields(
  metadata: ModelMetadataFields,
): ModelMetadataFields | undefined {
  if (
    metadata.contextWindow === undefined &&
    metadata.maxOutputTokens === undefined &&
    metadata.supportsVision === undefined &&
    metadata.reasoning === undefined &&
    metadata.status === undefined
  ) {
    return undefined;
  }
  return metadata;
}

function detectVisionSupport(
  modalities: { input?: string[]; output?: string[] } | undefined,
  attachmentHint: boolean | undefined,
): boolean | undefined {
  const inputModalities = Array.isArray(modalities?.input)
    ? modalities.input
    : undefined;
  if (inputModalities?.length) {
    return inputModalities.some((modality) => modality !== "text");
  }
  return typeof attachmentHint === "boolean" ? attachmentHint : undefined;
}

function shouldHideDeprecatedModel(
  modelId: string,
  vendor: ProviderDefinition["vendor"],
  snapshot: CachedModelMetadataSnapshot,
): boolean {
  if (vendor !== ZEN_VENDOR) {
    return false;
  }
  return snapshot.providers[vendor][modelId]?.status === "deprecated";
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
  return Boolean(fallbackModelMetadata(modelId, vendor));
}

function isFreeZenModel(modelId: string): boolean {
  return modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId);
}

function formatModelName(modelId: string): string {
  const parts = modelId.split("-");
  const displayParts: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (/^\d+$/.test(part) && /^\d+$/.test(parts[index + 1] ?? "")) {
      const versionParts = [part];

      while (/^\d+$/.test(parts[index + 1] ?? "")) {
        versionParts.push(parts[index + 1]);
        index += 1;
      }

      displayParts.push(versionParts.join("."));
      continue;
    }

    displayParts.push(part);
  }

  return displayParts
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
