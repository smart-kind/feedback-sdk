<template>
  <div class="feedback-entry">
    <button class="feedback-fab" @click="visible = true">意见</button>

    <div v-if="visible" class="feedback-mask" @click.self="visible = false">
      <div class="feedback-card">
        <h3>测试意见</h3>
        <textarea v-model="content" maxlength="1000" placeholder="说说遇到的问题…" />
        <div class="feedback-actions">
          <button :disabled="submitting" @click="visible = false">取消</button>
          <button :disabled="submitting" @click="submit">
            {{ submitting ? '提交中…' : '提交' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { submitFeedback } from 'feedback-sdk';

const visible = ref(false);
const content = ref('');
const submitting = ref(false);

async function submit() {
  if (submitting.value) return;
  const text = content.value.trim();
  if (!text) return;
  submitting.value = true;
  try {
    await submitFeedback({ content: text });
    content.value = '';
    visible.value = false;
  } catch (err) {
    alert(err?.message || '提交失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.feedback-fab {
  position: fixed;
  right: 24px;
  bottom: 120px;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #4ade80, #16a34a);
  box-shadow: 0 8px 22px rgba(22, 163, 74, 0.45);
  cursor: pointer;
}
.feedback-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.feedback-card {
  width: 340px;
  padding: 20px;
  border-radius: 16px;
  background: #f5e9e0;
}
.feedback-card h3 {
  margin: 0 0 12px;
  font-size: 18px;
}
.feedback-card textarea {
  width: 100%;
  height: 120px;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid #fce7e7;
  border-radius: 10px;
  resize: vertical;
}
.feedback-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}
.feedback-actions button {
  flex: 1;
  padding: 10px;
  border: 1px solid #fce7e7;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
}
.feedback-actions button:last-child {
  color: #fff;
  background: linear-gradient(to right, #22c55e, #15803d);
  border-color: transparent;
}
</style>
