'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Git integration. Runs git commands against the project repo. All local,
// no network. Gracefully degrades when git or the repo is unavailable.

function isGitRepo(rootDir) {
  return fs.existsSync(path.join(rootDir, '.git')) || fs.existsSync(path.join(rootDir, '.git', 'HEAD'));
}

function runGit(rootDir, args) {
  try {
    const out = execFileSync('git', ['-C', rootDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
    return out;
  } catch {
    return null;
  }
}

function getBranches(rootDir) {
  const out = runGit(rootDir, ['branch', '--format=%(refname:short)']);
  if (!out) return [];
  return out.split('\n').map((b) => b.trim()).filter(Boolean);
}

function currentBranch(rootDir) {
  const out = runGit(rootDir, ['branch', '--show-current']);
  return out ? out.trim() : null;
}

function getStatus(rootDir) {
  const out = runGit(rootDir, ['status', '--porcelain']);
  if (!out) return { modified: [], untracked: [], staged: [] };
  const res = { modified: [], untracked: [], staged: [] };
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2).trim();
    const file = line.slice(3);
    const pathOnly = file.split(' -> ').pop();
    if (code === '??') res.untracked.push(pathOnly);
    else if (code.startsWith('A') || code.startsWith('M') || code.startsWith('R') || code.startsWith('D')) res.staged.push(pathOnly);
    else res.modified.push(pathOnly);
  }
  return res;
}

function lastCommit(rootDir) {
  const out = runGit(rootDir, ['log', '-1', '--format=%h %s (%ar)']);
  return out ? out.trim() : null;
}

function fileHistory(rootDir, relPath) {
  const out = runGit(rootDir, ['log', '--format=%h %ad %s', '--date=short', '--', relPath]);
  if (!out) return [];
  return out.split('\n').filter(Boolean).slice(0, 20);
}

function changedInLastCommit(rootDir) {
  const out = runGit(rootDir, ['show', '--name-only', '--format=', 'HEAD']);
  if (!out) return [];
  return out.split('\n').map((f) => f.trim()).filter(Boolean);
}

function gatherGitInfo(rootDir) {
  if (!isGitRepo(rootDir)) return null;
  const info = {
    branches: getBranches(rootDir),
    currentBranch: currentBranch(rootDir),
    status: getStatus(rootDir),
    lastCommit: lastCommit(rootDir),
    recentCommits: [],
  };
  const log = runGit(rootDir, ['log', '-10', '--format=%h %s']);
  if (log) info.recentCommits = log.split('\n').filter(Boolean);
  return info;
}

module.exports = { isGitRepo, gatherGitInfo, getStatus, fileHistory, changedInLastCommit };
