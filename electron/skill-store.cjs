const { randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_ALWAYS_ON_SKILLS = 5;

function createSkillStore({ filePath, safeStorage }) {
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8'));
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure workflow storage is unavailable.');
      const skills = JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64')));
      return Array.isArray(skills) ? skills.map((skill) => ({ ...skill, alwaysOn: skill.alwaysOn === true })) : [];
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(skills) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure workflow storage is unavailable.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(skills)).toString('base64');
    await writeFile(filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
  }
  return {
    async list() { return read(); },
    async save({ id, name, instructions, alwaysOn }) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new TypeError('Workflow name must be 1–60 characters.');
      if (typeof instructions !== 'string' || !instructions.trim() || instructions.trim().length > 2500) throw new TypeError('Workflow instructions must be 1–2,500 characters.');
      if (alwaysOn !== undefined && typeof alwaysOn !== 'boolean') throw new TypeError('Always-on workflow setting must be true or false.');
      const skills = await read();
      const skillId = id || randomUUID();
      const index = skills.findIndex((item) => item.id === skillId);
      const shouldAlwaysOn = alwaysOn === undefined ? skills[index]?.alwaysOn === true : alwaysOn;
      if (shouldAlwaysOn && (index < 0 || skills[index].alwaysOn !== true) && skills.filter((item) => item.alwaysOn === true).length >= MAX_ALWAYS_ON_SKILLS) {
        throw new RangeError(`Choose up to ${MAX_ALWAYS_ON_SKILLS} always-on workflows.`);
      }
      const skill = { id: skillId, name: name.trim(), instructions: instructions.trim(), custom: true, alwaysOn: shouldAlwaysOn, updatedAt: Date.now() };
      if (index >= 0) skills[index] = skill; else {
        if (skills.length >= 50) throw new RangeError('You can save up to 50 custom workflows.');
        skills.push(skill);
      }
      await write(skills);
      return skill;
    },
    async remove(id) {
      const skills = await read();
      const remaining = skills.filter((skill) => skill.id !== id);
      if (remaining.length === skills.length) return false;
      await write(remaining);
      return true;
    },
  };
}

module.exports = { createSkillStore, MAX_ALWAYS_ON_SKILLS };
