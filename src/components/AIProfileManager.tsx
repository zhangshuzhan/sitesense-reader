import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, Key, Globe, Cpu, MessageSquare, Save, X, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { AIProfile } from '@/types';
import { useToastStore } from '@/stores/toastStore';

export default function AIProfileManager() {
  const { t } = useTranslation();
  const { aiProfiles, addAIProfile, updateAIProfile, deleteAIProfile } = useSettingsStore();
  const { addToast } = useToastStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [presetValue, setPresetValue] = useState('custom');

  // OpenAI-compatible presets. Domestic models all speak the OpenAI chat format,
  // so they reuse the "openai" provider with their own base URL + model name.
  // `model: 'auto'` is kept where the provider/gateway supports auto-routing; for
  // the rest we set a concrete default you can overwrite (including typing "auto").
  const MODEL_PRESETS = [
    { value: 'custom', label: 'aiProfileManager.presetCustom', provider: 'openai' as const, baseUrl: '', model: '' },
    { value: 'openai', label: 'OpenAI', provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { value: 'deepseek', label: 'DeepSeek', provider: 'openai' as const, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { value: 'qwen', label: '通义千问 Qwen', provider: 'openai' as const, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { value: 'kimi', label: 'Kimi 月之暗面', provider: 'openai' as const, baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { value: 'glm', label: '智谱 GLM', provider: 'openai' as const, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { value: 'hunyuan', label: '腾讯混元', provider: 'openai' as const, baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbo' },
    { value: 'ernie', label: '百度文心', provider: 'openai' as const, baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k' },
    { value: 'doubao', label: '豆包 火山方舟', provider: 'openai' as const, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1.6' },
    { value: 'stepfun', label: '阶跃星辰 StepFun', provider: 'openai' as const, baseUrl: 'https://api.stepfun.com/v1', model: 'step-1v-8k' },
    { value: 'minimax', label: 'MiniMax', provider: 'openai' as const, baseUrl: 'https://api.minimax.io/v1', model: 'abab6.5s-chat' },
    { value: 'baichuan', label: '百川 Baichuan', provider: 'openai' as const, baseUrl: 'https://api.baichuan-ai.com/v1', model: 'baichuan4' },
    { value: 'yi', label: '零一万物 Yi', provider: 'openai' as const, baseUrl: 'https://api.lingyiwanwu.com/v1', model: 'yi-large' },
    { value: 'spark', label: '讯飞星火', provider: 'openai' as const, baseUrl: 'https://spark-api-open.xfyun.cn/v1', model: 'generalv3.5' },
    { value: 'sensetime', label: '商汤 商量', provider: 'openai' as const, baseUrl: 'https://api.sensenova.cn/v1/llm/chat-completions', model: 'SenseChat-5' },
    { value: 'tiangong', label: '天工 昆仑', provider: 'openai' as const, baseUrl: 'https://api.tiangong.cn/v1', model: 'TiANGONG' },
    { value: 'siliconflow', label: '硅基流动 SiliconFlow', provider: 'openai' as const, baseUrl: 'https://api.siliconflow.cn/v1', model: 'auto' },
    { value: 'anthropic', label: 'Anthropic Claude', provider: 'anthropic' as const, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  ];

  const handlePresetChange = (value: string) => {
    const preset = MODEL_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    setPresetValue(value);
    setFormData((prev) => ({
      ...prev,
      provider: preset.provider,
      baseUrl: preset.baseUrl || prev.baseUrl,
      model: preset.model || prev.model,
      name: value === 'custom' ? prev.name : prev.name || preset.label,
    }));
  };

  // Selectable system-prompt templates. Picking one fills the prompt box, which the
  // user can still edit before saving. The dedicated 财经解读 button keeps its own
  // built-in financial prompt and is unaffected by this choice.
  const PROMPT_TEMPLATES: { value: string; label: string; prompt: string }[] = [
    {
      value: 'general',
      label: '通用摘要',
      prompt: '你是一个专业的文章摘要助手。请用简洁流畅的中文概括下面文章的核心内容，3-5 句话，保留关键事实与数据。',
    },
    {
      value: 'finance',
      label: '财经解读',
      prompt:
        '你是一名专业的财经/市场分析师。请阅读用户提供的文章内容，提取其财经与市场观点，并以 JSON 格式返回，不要包含任何额外说明文字。JSON 结构必须如下：\n{\n  "summary": "用 2-4 句话概括文章核心财经观点及其对市场/资产的影响",\n  "sentiment": "bullish | bearish | neutral",\n  "sentimentScore": -100 到 100 之间的整数，表示多空情绪强度,\n  "keywords": ["关键词1", "关键词2"]\n}\n若文章与财经/市场无关，sentiment 设为 neutral，sentimentScore 设为 0，keywords 留空数组。summary 与 keywords 请使用与原文相同的语言。',
    },
    {
      value: 'analysis',
      label: '深度分析',
      prompt: '你是一位资深分析师。请对下面的文章做深度解读：指出核心论点、支撑论据、潜在影响与可能的反方观点，结构清晰。',
    },
    {
      value: 'keywords',
      label: '关键词提取',
      prompt: '请从下面的文章中提取 5-10 个关键主题词/实体，用中文逗号分隔返回，不要解释。',
    },
    {
      value: 'translate',
      label: '翻译助手',
      prompt: '请将下面的内容翻译成流畅的中文；若原文已是中文，则翻译成英文。只输出译文。',
    },
    { value: 'custom', label: '自定义', prompt: '' },
  ];

  const [templateValue, setTemplateValue] = useState('general');

  const handleTemplateChange = (value: string) => {
    const tpl = PROMPT_TEMPLATES.find((t) => t.value === value);
    if (!tpl) return;
    setTemplateValue(value);
    setFormData((prev) => ({ ...prev, prompt: tpl.prompt }));
  };

  const initialProfile: Omit<AIProfile, 'id'> = {
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    prompt: 'You are a helpful assistant that summarizes articles. Please provide a concise summary of the following content.',
  };

  const [formData, setFormData] = useState<Omit<AIProfile, 'id'>>(initialProfile);

  const handleEdit = (profile: AIProfile) => {
    setFormData({
      name: profile.name,
      provider: profile.provider,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model,
      prompt: profile.prompt,
    });
    setEditingId(profile.id);
    setIsEditing(true);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('aiProfileManager.deleteConfirm'))) {
      deleteAIProfile(id);
      addToast({ message: t('aiProfileManager.deleteSuccess'), type: 'success' });
    }
  };

  const handleSave = () => {
    if (!formData.name || !formData.apiKey) {
      addToast({ message: t('aiProfileManager.nameAndKeyRequired'), type: 'error' });
      return;
    }

    if (editingId) {
      updateAIProfile(editingId, formData);
      addToast({ message: t('aiProfileManager.saveSuccess'), type: 'success' });
    } else {
      addAIProfile(formData);
      addToast({ message: t('aiProfileManager.saveSuccess'), type: 'success' });
    }
    resetForm();
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormData(initialProfile);
    setShowApiKey(false);
    setPresetValue('custom');
    setTemplateValue('general');
  };

  if (isEditing) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white">
            {editingId ? t('aiProfileManager.editProfile') : t('aiProfileManager.newProfile')}
          </h3>
          <button onClick={resetForm} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('aiProfileManager.name')}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('aiProfileManager.namePlaceholder')}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('aiProfileManager.preset')}
            </label>
            <select
              value={presetValue}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            >
              {MODEL_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('aiProfileManager.provider')}
              </label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value as 'openai' | 'anthropic' })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="openai">{t('aiProfileManager.openaiCompat')}</option>
                <option value="anthropic">{t('aiProfileManager.anthropicCompat')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  {t('aiProfileManager.model')}
                </div>
              </label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder={t('aiProfileManager.modelPlaceholder')}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {t('aiProfileManager.apiUrl')}
              </div>
            </label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              placeholder={t('aiProfileManager.apiUrlPlaceholder')}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                {t('aiProfileManager.apiKey')}
              </div>
            </label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={t('aiProfileManager.apiKeyPlaceholder')}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('aiProfileManager.promptTemplate')}
            </label>
            <select
              value={templateValue}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            >
              {PROMPT_TEMPLATES.map((tpl) => (
                <option key={tpl.value} value={tpl.value}>
                  {tpl.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                {t('aiProfileManager.systemPrompt')}
              </div>
            </label>
            <textarea
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              rows={5}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('aiProfileManager.promptNote')}
            </p>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              {t('aiProfileManager.cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {t('aiProfileManager.save')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-slate-900 dark:text-white">{t('aiProfileManager.profileList')}</h3>
        <button
          onClick={() => setIsEditing(true)}
          className="px-3 py-1.5 text-sm bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('aiProfileManager.new')}
        </button>
      </div>

      {aiProfiles.length === 0 ? (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
          <p>{t('aiProfileManager.noProfiles')}</p>
          <p className="text-sm mt-1">{t('aiProfileManager.noProfilesHint')}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {aiProfiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg group hover:border-primary-500/50 dark:hover:border-primary-500/50 transition-colors"
            >
              <div>
                <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  {profile.name}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-normal">
                    {profile.provider}
                  </span>
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {profile.model} · {new URL(profile.baseUrl).hostname}
                </p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEdit(profile)}
                  className="p-1.5 text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(profile.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
