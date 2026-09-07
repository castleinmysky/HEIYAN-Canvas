import { useState } from 'react';
import { UiIcon } from './UiIcon';

export function SettingsCenterPreview() {
  const [open, setOpen] = useState(false);
  return <section className="settings-center-preview" aria-label="设置中心触发器状态预览">
    <button type="button" className="settings-preview-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}><UiIcon name="settings" />{open ? '设置已打开' : '打开设置'}</button>
    <button type="button" className="settings-preview-trigger is-loading" aria-busy="true"><UiIcon name="settings" />读取中</button>
    <button type="button" className="settings-preview-trigger" disabled><UiIcon name="settings" />不可用</button>
    <span className="settings-inline-error">连接失败状态</span>
    <span className="settings-inline-notice">保存成功状态</span>
  </section>;
}
