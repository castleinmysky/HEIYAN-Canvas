import { describe, expect, it } from 'vitest';
import { connectorErrorMessage } from './LocalConnectorSettings';

describe('connection error explanations', () => {
  it('separates unfinished tasks, tab conflicts and connector compatibility', () => {
    expect(connectorErrorMessage({ code: 'tasks_bound_to_original', taskCount: 3 }, 409, false, true)).toContain('3 个');
    expect(connectorErrorMessage({ code: 'connection_changed' }, 409, false, true)).toContain('其他标签页');
    expect(connectorErrorMessage({ code: 'connector_update_required' }, 409, false, true)).toContain('版本或模型数据不兼容');
    expect(connectorErrorMessage({ code: 'connector_rejected' }, 409, false, true)).not.toContain('任务绑定');
  });
  it('keeps English errors in English and preserves their precise cause', () => {
    const error = 'Another tab changed the connection. Check it and try again.';
    expect(connectorErrorMessage({ code: 'connection_changed', error }, 409, true, true)).toBe(error);
    expect(connectorErrorMessage({}, 503, true, true)).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it('distinguishes requesting cancellation from confirmed remote cancellation', () => {
    expect(connectorErrorMessage({ code: 'tasks_bound_to_original' }, 409, false, true)).toContain('取消原任务');
    expect(connectorErrorMessage({ code: 'cancellation_unconfirmed' }, 409, false, true)).toContain('原机器可能仍在执行');
    expect(connectorErrorMessage({ code: 'cancellation_pending' }, 409, false, true)).toContain('等待原机器确认');
  });
});
