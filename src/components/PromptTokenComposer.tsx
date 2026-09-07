import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  astralAvatarPromptTokenId,
  duplicateCharacterNegativePromptTokenId,
  filterPromptTokens,
  normalizedPromptTokenIds,
  promptDialectForAdapter,
  promptDialectLabel,
  promptTokenDisplayLabel,
  promptTokenById,
  promptTokenGroupRank,
  promptTokenGroupNavigation,
  promptTokenNavigation,
  promptTokenTone,
  reconcilePromptTokenConflicts,
  supportsNegativePromptTokens,
  type PromptTokenScope,
  type PromptTokenTarget,
  type PromptTokenTone,
} from '../prompt-token-library';
import { UiIcon, type UiIconName } from './UiIcon';
import './PromptTokenComposer.css';

export type PromptTokenComposerPatch = {
  promptTokenIds?: string[];
  negativePromptTokenIds?: string[];
};

type PromptTokenComposerProps = {
  layout?: 'panel' | 'inline' | 'embedded' | 'toolcard';
  persistenceKey?: string;
  adapter?: string;
  modelFamily?: string;
  target?: PromptTokenTarget;
  manualPrompt?: string;
  promptTokenIds?: string[];
  negativePromptTokenIds?: string[];
  onChange: (patch: PromptTokenComposerPatch) => void;
  onTokenToggle?: (token: PromptTokenSelectionTag, selected: boolean) => void;
};

export type PromptTokenSelectionTag = {
  id: string;
  scope: PromptTokenScope;
  label: string;
  value: string;
  tone: PromptTokenTone;
};

type PromptCascadeSectionProps = {
  scope: PromptTokenScope;
  adapter?: string;
  modelFamily?: string;
  target: PromptTokenTarget;
  selectedIds: string[];
  search: string;
  toolbar?: ReactNode;
  collapsibleHierarchy?: boolean;
  hideHeader?: boolean;
  hideSelection?: boolean;
  persistenceKey?: string;
  initialNavigation?: PromptTokenComposerSectionState;
  disabledIds?: string[];
  disabledReasonById?: Readonly<Record<string, string>>;
  onChange: (ids: string[]) => void;
  onTokenToggle?: (token: PromptTokenSelectionTag, selected: boolean) => void;
};

export type PromptTokenComposerSectionState = {
  sectionId: string;
  groupIdsBySection: Record<string, string>;
  expandedTokenGroups: string[];
  hierarchyExpanded: boolean;
};

export type PromptTokenComposerViewState = {
  activeScope: PromptTokenScope;
  recipesExpanded: boolean;
  sections: Partial<Record<PromptTokenScope, PromptTokenComposerSectionState>>;
};

const promptTokenComposerViewStoragePrefix = 'ai-canvas:prompt-token-composer:view:v1:';

const cleanStateText = (value: unknown, maxLength = 100) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizePromptTokenComposerSectionState = (value: unknown): PromptTokenComposerSectionState | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const groupIds = source.groupIdsBySection && typeof source.groupIdsBySection === 'object' && !Array.isArray(source.groupIdsBySection)
    ? Object.fromEntries(Object.entries(source.groupIdsBySection).slice(0, 16).flatMap(([sectionId, groupId]) => {
      const cleanSectionId = cleanStateText(sectionId);
      const cleanGroupId = cleanStateText(groupId);
      return cleanSectionId && cleanGroupId ? [[cleanSectionId, cleanGroupId]] : [];
    }))
    : {};
  const expandedTokenGroups = Array.isArray(source.expandedTokenGroups)
    ? [...new Set(source.expandedTokenGroups.map((id) => cleanStateText(id, 180)).filter(Boolean))].slice(0, 24)
    : [];
  return {
    sectionId: cleanStateText(source.sectionId),
    groupIdsBySection: groupIds,
    expandedTokenGroups,
    hierarchyExpanded: source.hierarchyExpanded === true,
  };
};

export function normalizePromptTokenComposerViewState(value: unknown): PromptTokenComposerViewState {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawSections = source.sections && typeof source.sections === 'object' && !Array.isArray(source.sections) ? source.sections as Record<string, unknown> : {};
  const positive = normalizePromptTokenComposerSectionState(rawSections.positive);
  const negative = normalizePromptTokenComposerSectionState(rawSections.negative);
  return {
    activeScope: source.activeScope === 'negative' ? 'negative' : 'positive',
    recipesExpanded: source.recipesExpanded === true,
    sections: { ...(positive ? { positive } : {}), ...(negative ? { negative } : {}) },
  };
}

function promptTokenComposerViewStorageKey(persistenceKey?: string) {
  const key = cleanStateText(persistenceKey, 180);
  return key ? `${promptTokenComposerViewStoragePrefix}${encodeURIComponent(key)}` : '';
}

function readPromptTokenComposerViewState(persistenceKey?: string) {
  const storageKey = promptTokenComposerViewStorageKey(persistenceKey);
  if (!storageKey || typeof window === 'undefined') return normalizePromptTokenComposerViewState(null);
  try { return normalizePromptTokenComposerViewState(JSON.parse(window.localStorage.getItem(storageKey) || 'null')); }
  catch { return normalizePromptTokenComposerViewState(null); }
}

function rememberPromptTokenComposerViewState(persistenceKey: string | undefined, patch: Partial<PromptTokenComposerViewState>) {
  const storageKey = promptTokenComposerViewStorageKey(persistenceKey);
  if (!storageKey || typeof window === 'undefined') return;
  try {
    const current = readPromptTokenComposerViewState(persistenceKey);
    const next = normalizePromptTokenComposerViewState({
      ...current,
      ...patch,
      sections: { ...current.sections, ...(patch.sections || {}) },
    });
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch { /* interface memory is optional */ }
}

const sectionIcons: Record<string, UiIconName> = {
  subject: 'character', wardrobe: 'collection', action: 'run', camera: 'view', environment: 'image', elements: 'spark', finish: 'candidate',
  quality: 'candidate', anatomy: 'character', frame: 'crop', content: 'clear',
};

const categoryIcons: Record<string, UiIconName> = {
  人物: 'character', 服饰: 'collection', 汉服: 'collection', 表情动作: 'run', 构图: 'crop', 镜头: 'view',
  场景: 'image', 建筑: 'model3d', 自然: 'image', 光影环境: 'spark', 色彩: 'candidate', 物品: 'collection',
  生物: 'character', 魔法: 'spark', 特效: 'spark', 画风: 'edit', 质量渲染: 'check', 质量: 'check',
  人体: 'character', 手部: 'character', 面部: 'character', 文字: 'text', 背景: 'image', 色彩光线: 'spark', 内容控制: 'clear',
};
const promptTokenGroupKey = (category: string, group: string) => `${category}:${group}`;

function promptComposerLanguageLabel(adapter: string | undefined, modelFamily: string | undefined, target: PromptTokenTarget) {
  const dialectLabel = promptDialectLabel(adapter, modelFamily);
  if (dialectLabel !== '自然语言') return dialectLabel;
  return target === 'video' ? '视频描述' : target === 'model' ? '3D 描述' : dialectLabel;
}

export function promptHierarchyIsVisible(collapsible: boolean, expanded: boolean, search: string) {
  return !collapsible || expanded || Boolean(search.trim());
}

export function nextPromptHierarchyExpanded(activeSectionId: string, nextSectionId: string, expanded: boolean) {
  return activeSectionId === nextSectionId ? !expanded : true;
}

export function horizontalDragScrollLeft(startScrollLeft: number, startClientX: number, currentClientX: number) {
  return Math.max(0, startScrollLeft - (currentClientX - startClientX));
}

export const promptTokenCompactLimit = 24;

export function compactPromptTokenEntries<T extends { id: string }>(entries: T[], selectedIds: string[], expanded: boolean, searching: boolean, limit = promptTokenCompactLimit): T[] {
  if (searching || expanded || entries.length <= limit) return entries;
  const selected = new Set(selectedIds);
  return entries.filter((entry, index) => index < limit || selected.has(entry.id));
}

function PromptCascadeSection({ scope, adapter, modelFamily, target, selectedIds, search, toolbar, collapsibleHierarchy = false, hideHeader = false, hideSelection = false, persistenceKey, initialNavigation, disabledIds = [], disabledReasonById = {}, onChange, onTokenToggle }: PromptCascadeSectionProps) {
  const dialect = promptDialectForAdapter(adapter, modelFamily);
  const navigation = promptTokenNavigation[scope].filter((item) => item.categories.some((category) => filterPromptTokens(scope, category, '', target).length));
  const [sectionId, setSectionId] = useState(initialNavigation?.sectionId || navigation[0]?.id || '');
  const [groupIdsBySection, setGroupIdsBySection] = useState<Record<string, string>>(initialNavigation?.groupIdsBySection || {});
  const [expandedTokenGroups, setExpandedTokenGroups] = useState<Set<string>>(() => new Set(initialNavigation?.expandedTokenGroups || []));
  const [hierarchyExpanded, setHierarchyExpanded] = useState(initialNavigation ? initialNavigation.hierarchyExpanded : !collapsibleHierarchy);
  const groupDragRef = useRef<{ pointerId: number; startClientX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const suppressGroupClickRef = useRef(false);
  const activeSection = navigation.find((item) => item.id === sectionId) || navigation[0];
  const query = search.trim();
  const hierarchyVisible = promptHierarchyIsVisible(collapsibleHierarchy, hierarchyExpanded, query);
  const sectionTokens = (activeSection?.categories || []).flatMap((category) => filterPromptTokens(scope, category, '', target));
  const sectionCategoryRank = new Map((activeSection?.categories || []).map((category, index) => [category, index]));
  const sourceGroups = [...sectionTokens.reduce<Map<string, { id: string; category: string; label: string; count: number }>>((groups, entry) => {
    const id = promptTokenGroupKey(entry.category, entry.group);
    const current = groups.get(id);
    groups.set(id, current ? { ...current, count: current.count + 1 } : { id, category: entry.category, label: entry.group, count: 1 });
    return groups;
  }, new Map()).values()]
    .sort((left, right) => {
      const categoryDifference = (sectionCategoryRank.get(left.category) ?? Number.MAX_SAFE_INTEGER)
        - (sectionCategoryRank.get(right.category) ?? Number.MAX_SAFE_INTEGER);
      if (categoryDifference) return categoryDifference;
      const groupDifference = promptTokenGroupRank(left.category, left.label) - promptTokenGroupRank(right.category, right.label);
      return groupDifference || left.label.localeCompare(right.label, 'zh-CN');
    });
  const sourceGroupMap = new Map(sourceGroups.map((group) => [group.id, group]));
  const coveredSourceGroups = new Set<string>();
  const configuredGroups = promptTokenGroupNavigation[scope][activeSection?.id || ''] || [];
  const groupedNavigation = configuredGroups.flatMap((group) => {
    const memberIds = group.members
      .map(([category, label]) => promptTokenGroupKey(category, label))
      .filter((id) => sourceGroupMap.has(id));
    if (!memberIds.length) return [];
    memberIds.forEach((id) => coveredSourceGroups.add(id));
    return [{
      id: group.id,
      label: group.label,
      dividerBefore: Boolean(group.dividerBefore),
      count: memberIds.reduce((count, id) => count + (sourceGroupMap.get(id)?.count || 0), 0),
      memberIds,
    }];
  });
  const fallbackNavigation = sourceGroups
    .filter((group) => !coveredSourceGroups.has(group.id))
    .map((group) => ({ id: group.id, label: group.label, dividerBefore: false, count: group.count, memberIds: [group.id] }));
  const groupNavigation = [...groupedNavigation, ...fallbackNavigation]
    .map((group) => ({ ...group, tone: activeSection?.id as PromptTokenTone || (scope === 'negative' ? 'content' : 'subject') }));
  const requestedGroupId = activeSection ? groupIdsBySection[activeSection.id] : '';
  const activeGroup = groupNavigation.find((group) => group.id === requestedGroupId) || groupNavigation[0];
  const allTokens = query
    ? filterPromptTokens(scope, '全部', query, target)
    : activeGroup ? sectionTokens
      .filter((entry) => activeGroup.memberIds.includes(promptTokenGroupKey(entry.category, entry.group)))
      .sort((left, right) => activeGroup.memberIds.indexOf(promptTokenGroupKey(left.category, left.group))
        - activeGroup.memberIds.indexOf(promptTokenGroupKey(right.category, right.group))) : sectionTokens;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);
  const tokenGroupDisplayKey = `${scope}:${activeSection?.id || ''}:${activeGroup?.id || ''}`;
  const tokenGroupExpanded = expandedTokenGroups.has(tokenGroupDisplayKey);
  const tokens = compactPromptTokenEntries(allTokens, selectedIds, tokenGroupExpanded, Boolean(query));
  const hiddenTokenCount = allTokens.length - tokens.length;
  const isNegative = scope === 'negative';

  useEffect(() => {
    rememberPromptTokenComposerViewState(persistenceKey, { sections: { [scope]: {
      sectionId,
      groupIdsBySection,
      expandedTokenGroups: [...expandedTokenGroups],
      hierarchyExpanded,
    } } });
  }, [expandedTokenGroups, groupIdsBySection, hierarchyExpanded, persistenceKey, scope, sectionId]);

  const chooseSection = (nextSectionId: string) => {
    if (collapsibleHierarchy) {
      setHierarchyExpanded((current) => nextPromptHierarchyExpanded(activeSection?.id || '', nextSectionId, current));
    }
    setSectionId(nextSectionId);
  };
  const chooseGroup = (nextGroupId: string) => {
    if (!activeSection) return;
    setGroupIdsBySection((current) => ({ ...current, [activeSection.id]: nextGroupId }));
  };
  const beginGroupDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    event.stopPropagation();
    suppressGroupClickRef.current = false;
    groupDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };
  const moveGroupDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(deltaX) < 4) return;
    if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId);
    drag.moved = true;
    suppressGroupClickRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.scrollLeft = horizontalDragScrollLeft(drag.startScrollLeft, drag.startClientX, event.clientX);
  };
  const endGroupDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove('is-dragging');
    groupDragRef.current = null;
    if (cancelled || !drag.moved) suppressGroupClickRef.current = false;
    else window.setTimeout(() => { suppressGroupClickRef.current = false; }, 0);
  };
  const applySelection = (nextIds: string[]) => {
    const nextSet = new Set(nextIds);
    const changedIds = [...new Set([...selectedIds, ...nextIds])].filter((id) => selectedSet.has(id) !== nextSet.has(id));
    changedIds.forEach((id) => {
      const entry = promptTokenById(id);
      if (!entry) return;
      onTokenToggle?.({ id, scope, label: promptTokenDisplayLabel(entry, adapter, modelFamily), value: entry.values[dialect], tone: promptTokenTone(entry) }, nextSet.has(id));
    });
    onChange(nextIds);
  };
  const toggleToken = (tokenId: string) => !disabledSet.has(tokenId) && applySelection(selectedSet.has(tokenId)
    ? selectedIds.filter((id) => id !== tokenId)
    : [...selectedIds, tokenId]);
  const sectionNavigation = !query ? <nav className="prompt-cascade-sections" aria-label={isNegative ? '排除问题分类' : '创作步骤'}>
    {navigation.map((item) => {
      const active = activeSection?.id === item.id;
      return <button type="button" key={item.id} data-tone={item.id} className={active ? 'active' : ''} aria-pressed={active} aria-expanded={collapsibleHierarchy && active ? hierarchyVisible : undefined} title={`${item.hint}${collapsibleHierarchy ? active && hierarchyVisible ? ' · 点击收起细分' : ' · 点击展开细分' : ''}`} onClick={() => chooseSection(item.id)}><UiIcon name={sectionIcons[item.id] || 'spark'} /><span>{item.label}</span>{collapsibleHierarchy && active && <i className="prompt-cascade-disclosure" aria-hidden="true">›</i>}</button>;
    })}
  </nav> : null;

  return <section className={`prompt-cascade-section${isNegative ? ' is-negative' : ''}${hierarchyVisible ? ' is-hierarchy-open' : ' is-hierarchy-collapsed'}`} aria-label={isNegative ? '反向提示词预设器' : '正向提示词预设器'}>
    {!hideHeader && <header className="prompt-cascade-section__head">
      <span aria-hidden="true">⌄</span>
      <strong>{isNegative ? '反向词库' : '提示词预设'}</strong>
      <small>{isNegative ? 'Negative Prompt' : `${promptComposerLanguageLabel(adapter, modelFamily, target)} · 与上方输入共同提交`}</small>
    </header>}

    {!hideSelection && <div className="prompt-cascade-selected" aria-label={isNegative ? '已选反向词条' : '已选提示词'}>
      <span className="prompt-cascade-selected__label">{isNegative ? '已选反向' : '已选正向'}</span>
      {selectedIds.length ? selectedIds.map((tokenId) => {
        const entry = promptTokenById(tokenId);
        if (!entry) return null;
        const displayLabel = promptTokenDisplayLabel(entry, adapter, modelFamily);
        return <button type="button" key={tokenId} title={`${displayLabel} · 实际写入：${entry.values[dialect]} · 点击移除`} onClick={() => toggleToken(tokenId)}><span>{displayLabel}</span><b>×</b></button>;
      }) : <span className="prompt-cascade-selected__empty">点击下方词条加入当前提示词</span>}
      {selectedIds.length > 0 && <button type="button" className="prompt-cascade-clear" onClick={() => applySelection([])}>清空</button>}
    </div>}

    {sectionNavigation && toolbar ? <div className="prompt-cascade-section-rail">{sectionNavigation}{toolbar}</div> : sectionNavigation}

    {hierarchyVisible && <div className="prompt-cascade-hierarchy">
      {!query && groupNavigation.length > 1 && <nav
        className="prompt-cascade-groups"
        aria-label={`${activeSection?.label || '当前'}类型`}
        data-drag-scroll="horizontal"
        onPointerDown={beginGroupDrag}
        onPointerMove={moveGroupDrag}
        onPointerUp={(event) => endGroupDrag(event)}
        onPointerCancel={(event) => endGroupDrag(event, true)}
        onClickCapture={(event) => {
          if (!suppressGroupClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressGroupClickRef.current = false;
        }}
      >
        {groupNavigation.map((group, index) => <Fragment key={group.id}>
          {index > 0 && group.dividerBefore ? <span className="prompt-cascade-group-divider" aria-hidden="true" /> : null}
          <button
            type="button"
            data-tone={group.tone}
            className={activeGroup?.id === group.id ? 'active' : ''}
            aria-pressed={activeGroup?.id === group.id}
            title={`${group.label} · ${group.count} 个词条`}
            onClick={() => chooseGroup(group.id)}
          ><span>{group.label}</span></button>
        </Fragment>)}
      </nav>}

      {query && <div className="prompt-cascade-search-result"><span>“{query}”的结果</span><b>{tokens.length} 项</b></div>}
      <div className="prompt-cascade-tokens" aria-label={query ? '搜索结果' : `${activeSection?.label || '当前'} · ${activeGroup?.label || '词条'}`}>
        {tokens.map((entry) => <button
          type="button"
          key={entry.id}
          data-tone={promptTokenTone(entry)}
          className={selectedSet.has(entry.id) ? 'active' : ''}
          disabled={disabledSet.has(entry.id)}
          aria-pressed={selectedSet.has(entry.id)}
          title={disabledSet.has(entry.id) ? disabledReasonById[entry.id] || '与当前选择冲突' : `实际写入：${entry.values[dialect]}`}
          onClick={() => toggleToken(entry.id)}
        ><strong>{entry.label}</strong>{selectedSet.has(entry.id) && <span className="prompt-cascade-token-check" aria-hidden="true">✓</span>}</button>)}
        {!query && allTokens.length > promptTokenCompactLimit && <button
          type="button"
          className="prompt-cascade-more"
          aria-expanded={tokenGroupExpanded}
          title={tokenGroupExpanded ? '收起专业参数' : `显示其余 ${hiddenTokenCount} 项专业参数`}
          onClick={() => setExpandedTokenGroups((current) => {
            const next = new Set(current);
            if (next.has(tokenGroupDisplayKey)) next.delete(tokenGroupDisplayKey);
            else next.add(tokenGroupDisplayKey);
            return next;
          })}
        ><strong>{tokenGroupExpanded ? '收起参数' : `更多参数 ${hiddenTokenCount}`}</strong><span aria-hidden="true">›</span></button>}
        {!tokens.length && <p>没有匹配词条，换个关键词试试</p>}
      </div>
    </div>}
  </section>;
}

export function resolvePromptTokenSelectionTags(adapter?: string, promptTokenIds?: string[], negativePromptTokenIds?: string[], target: PromptTokenTarget = 'image', modelFamily?: string): PromptTokenSelectionTag[] {
  const dialect = promptDialectForAdapter(adapter, modelFamily);
  const selectedPositive = normalizedPromptTokenIds(promptTokenIds, 'positive');
  const selectedNegative = normalizedPromptTokenIds(negativePromptTokenIds, 'negative');
  return [
    ...selectedPositive.map((id) => ({ id, scope: 'positive' as const, entry: promptTokenById(id) })),
    ...selectedNegative.map((id) => ({ id, scope: 'negative' as const, entry: promptTokenById(id) })),
  ].flatMap(({ id, scope, entry }) => entry && filterPromptTokens(scope, entry.category, '', target).some((candidate) => candidate.id === id)
    ? [{ id, scope, label: promptTokenDisplayLabel(entry, adapter, modelFamily), value: entry.values[dialect], tone: promptTokenTone(entry) }]
    : []);
}

export function PromptTokenComposer({ layout = 'panel', persistenceKey, adapter, modelFamily, target = 'image', promptTokenIds, negativePromptTokenIds, onChange, onTokenToggle }: PromptTokenComposerProps) {
  const negativeSupported = supportsNegativePromptTokens(adapter);
  const applicablePositiveIds = new Set(filterPromptTokens('positive', '全部', '', target).map((entry) => entry.id));
  const applicableNegativeIds = new Set(filterPromptTokens('negative', '全部', '', target).map((entry) => entry.id));
  const selectedPositive = normalizedPromptTokenIds(promptTokenIds, 'positive').filter((id) => applicablePositiveIds.has(id));
  const selectedNegative = normalizedPromptTokenIds(negativePromptTokenIds, 'negative').filter((id) => applicableNegativeIds.has(id));
  const dialect = promptDialectForAdapter(adapter, modelFamily);
  const requestsRealPhotography = selectedPositive.some((id) => id.startsWith('style-photo-') || id.startsWith('detail-real-'));
  const disabledNegativeReasonById = {
    ...(selectedPositive.includes(astralAvatarPromptTokenId) ? { [duplicateCharacterNegativePromptTokenId]: '与已选“元神法相”冲突' } : {}),
    ...(requestsRealPhotography ? { 'negative-photorealistic': '与已选“照片类型”或“真实细节”冲突' } : {}),
  };
  const disabledNegativeIds = Object.keys(disabledNegativeReasonById);
  const embedded = layout === 'embedded';
  const toolcard = layout === 'toolcard';
  const compact = embedded || toolcard;
  const restoredView = useMemo(() => readPromptTokenComposerViewState(persistenceKey), [persistenceKey]);
  const [expanded, setExpanded] = useState(!embedded);
  const [activeScope, setActiveScope] = useState<PromptTokenScope>(negativeSupported ? restoredView.activeScope : 'positive');
  const [search, setSearch] = useState('');
  const [recipesExpanded, setRecipesExpanded] = useState(restoredView.recipesExpanded);
  const composerRootRef = useRef<HTMLElement | null>(null);
  const [bookmarkPortalTarget, setBookmarkPortalTarget] = useState<HTMLElement | null>(null);
  const selectedCount = selectedPositive.length + selectedNegative.length;
  const rememberedSections = persistenceKey ? readPromptTokenComposerViewState(persistenceKey).sections : restoredView.sections;

  const bodyVisible = toolcard || expanded;
  useEffect(() => {
    if (!negativeSupported && activeScope === 'negative') setActiveScope('positive');
  }, [activeScope, negativeSupported]);
  useEffect(() => {
    rememberPromptTokenComposerViewState(persistenceKey, { activeScope, recipesExpanded });
  }, [activeScope, persistenceKey, recipesExpanded]);
  useLayoutEffect(() => {
    if (!toolcard || typeof window === 'undefined') return undefined;
    const compactMedia = window.matchMedia('(max-width: 680px)');
    const syncBookmarkHost = () => {
      const panel = composerRootRef.current?.closest('.generator-editor-panel');
      setBookmarkPortalTarget(compactMedia.matches && panel ? null : panel instanceof HTMLElement ? panel : null);
    };
    syncBookmarkHost();
    compactMedia.addEventListener('change', syncBookmarkHost);
    return () => compactMedia.removeEventListener('change', syncBookmarkHost);
  }, [toolcard]);
  const notifySelectionDifference = (scope: PromptTokenScope, previousIds: readonly string[], nextIds: readonly string[]) => {
    const previous = new Set(previousIds);
    const next = new Set(nextIds);
    [...new Set([...previousIds, ...nextIds])].forEach((id) => {
      if (previous.has(id) === next.has(id)) return;
      const entry = promptTokenById(id);
      if (entry) onTokenToggle?.({ id, scope, label: promptTokenDisplayLabel(entry, adapter, modelFamily), value: entry.values[dialect], tone: promptTokenTone(entry) }, next.has(id));
    });
  };
  const applyPositiveSelection = (ids: string[]) => {
    const resolved = reconcilePromptTokenConflicts(ids, selectedNegative);
    const negativeChanged = resolved.negativeIds.length !== selectedNegative.length
      || resolved.negativeIds.some((id, index) => id !== selectedNegative[index]);
    notifySelectionDifference('negative', selectedNegative, resolved.negativeIds);
    onChange({
      promptTokenIds: resolved.positiveIds,
      ...(negativeChanged ? { negativePromptTokenIds: resolved.negativeIds } : {}),
    });
  };
  const applyNegativeSelection = (ids: string[]) => {
    const requestedIds = normalizedPromptTokenIds(ids, 'negative');
    const resolved = reconcilePromptTokenConflicts(selectedPositive, requestedIds);
    notifySelectionDifference('negative', requestedIds, resolved.negativeIds);
    onChange({ negativePromptTokenIds: resolved.negativeIds });
  };
  const modeBar = compact && negativeSupported ? <nav className={`prompt-cascade-modebar${toolcard ? ' is-bookmarkbar' : ''}`} aria-label="正向或负向提示词预设">
    <span className="prompt-cascade-scope-tabs">
      <button type="button" data-prompt-scope="positive" className={activeScope === 'positive' ? 'active' : ''} aria-label="正向提示词" aria-pressed={activeScope === 'positive'} onClick={() => { setActiveScope('positive'); setSearch(''); setRecipesExpanded(false); }}><UiIcon name="add" /><span><strong>正向</strong><small>提示词</small></span><b>{selectedPositive.length}</b></button>
      <button type="button" data-prompt-scope="negative" className={activeScope === 'negative' ? 'active' : ''} aria-label="负向提示词" aria-pressed={activeScope === 'negative'} onClick={() => { setActiveScope('negative'); setSearch(''); setRecipesExpanded(false); }}><UiIcon name="clear" /><span><strong>负向</strong><small>提示词</small></span><b>{selectedNegative.length}</b></button>
    </span>
  </nav> : null;
  const composer = <section ref={composerRootRef} className={`prompt-token-composer${layout === 'inline' ? ' is-inline' : ''}${embedded ? ` is-embedded${expanded ? ' is-expanded' : ''}` : ''}${toolcard ? ' is-toolcard is-expanded' : ''}`} aria-label="提示词级联预设器">
    {embedded && <button type="button" className="prompt-cascade-trigger" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span><strong>提示词预设</strong><small>{promptComposerLanguageLabel(adapter, modelFamily, target)} · 点击选择词条</small></span>
      <span><b>{selectedCount ? `${selectedCount} 条` : '选择'}</b><i aria-hidden="true">⌄</i></span>
    </button>}
    {toolcard && !bookmarkPortalTarget && modeBar}
    {bodyVisible && <div className="prompt-cascade-body">
      {!toolcard && modeBar}
      {(!compact || activeScope === 'positive') && <PromptCascadeSection key="positive" scope="positive" adapter={adapter} modelFamily={modelFamily} target={target} selectedIds={selectedPositive} search={search} collapsibleHierarchy={toolcard} hideHeader={compact} hideSelection={compact} persistenceKey={persistenceKey} initialNavigation={rememberedSections.positive} onTokenToggle={onTokenToggle} onChange={applyPositiveSelection} />}
      {negativeSupported && (!compact || activeScope === 'negative') && <PromptCascadeSection key="negative" scope="negative" adapter={adapter} modelFamily={modelFamily} target={target} selectedIds={selectedNegative} search={search} collapsibleHierarchy={toolcard} hideHeader={compact} hideSelection={compact} persistenceKey={persistenceKey} initialNavigation={rememberedSections.negative} disabledIds={disabledNegativeIds} disabledReasonById={disabledNegativeReasonById} onTokenToggle={onTokenToggle} onChange={applyNegativeSelection} />}
    </div>}
  </section>;
  return <>{composer}{toolcard && bookmarkPortalTarget && modeBar ? createPortal(modeBar, bookmarkPortalTarget) : null}</>;
}
