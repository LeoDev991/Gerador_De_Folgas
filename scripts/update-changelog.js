const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const changelogPath = path.join(__dirname, '..', 'CHANGELOG_GERACAO.md');

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

function buildEntry(messageArg) {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);

  // Try reading git info
  const gitHash = safeExec('git rev-parse --short HEAD');
  const gitAuthor = safeExec('git show -s --format=%an HEAD');
  const gitEmail = safeExec('git show -s --format=%ae HEAD');
  const gitMessage = safeExec('git show -s --format=%s HEAD');
  const files = safeExec('git diff-tree --no-commit-id --name-only -r HEAD');

  const shortHash = gitHash || 'no-git';
  const message = (messageArg && messageArg.length) ? messageArg.join(' ') : (gitMessage || 'Atualização automática');

  let entry = `\n---\n\n## ${timestamp} — ${shortHash}\n\n**Resumo:** ${message}\n\n`;
  if (gitAuthor || gitEmail) entry += `**Autor:** ${gitAuthor || ''}${gitEmail ? ' <' + gitEmail + '>' : ''}\n\n`;
  if (files) {
    const fileList = files.split('\n').filter(Boolean).map(f => `- ${f}`).join('\n');
    entry += `**Arquivos modificados:**\n${fileList}\n\n`;
  }
  entry += `> Inserido automaticamente pelo script \`scripts/update-changelog.js\`\n`;
  return entry;
}

function appendEntry(entry) {
  try {
    fs.appendFileSync(changelogPath, entry, { encoding: 'utf8' });
    console.log('CHANGELOG_GERACAO.md atualizado.');
    return true;
  } catch (err) {
    console.error('Falha ao atualizar CHANGELOG_GERACAO.md:', err.message);
    return false;
  }
}

// CLI: optional message args
const args = process.argv.slice(2);
const entry = buildEntry(args);
const ok = appendEntry(entry);
process.exit(ok ? 0 : 1);
