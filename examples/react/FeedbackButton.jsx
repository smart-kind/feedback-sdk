import { useState } from 'react';
import { submitFeedback } from 'feedback-sdk';

export default function FeedbackButton() {
  const [visible, setVisible] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    const text = content.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await submitFeedback({ content: text });
      setContent('');
      setVisible(false);
    } catch (err) {
      alert(err?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => setVisible(true)}
        style={{
          position: 'fixed',
          right: 24,
          bottom: 120,
          width: 56,
          height: 56,
          border: 0,
          borderRadius: '50%',
          color: '#fff',
          background: 'linear-gradient(135deg, #4ade80, #16a34a)',
          cursor: 'pointer',
        }}
      >
        意见
      </button>

      {visible && (
        <div
          onClick={(e) => e.target === e.currentTarget && setVisible(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ width: 340, padding: 20, borderRadius: 16, background: '#f5e9e0' }}>
            <h3 style={{ margin: '0 0 12px' }}>测试意见</h3>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={1000}
              placeholder="说说遇到的问题…"
              style={{ width: '100%', height: 120, boxSizing: 'border-box', padding: 10 }}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button onClick={() => setVisible(false)} style={{ flex: 1 }}>
                取消
              </button>
              <button onClick={submit} disabled={submitting} style={{ flex: 1 }}>
                {submitting ? '提交中…' : '提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
