export function projectPrefix(id) {
  return `projects/${id}/`;
}

export function filesPrefix(id) {
  return `projects/${id}/files/`;
}

export function objectKey(id, rel) {
  return rel ? `projects/${id}/files/${rel}` : `projects/${id}/files/`;
}

export function metaKey(id) {
  return `projects/${id}/.agent/meta.json`;
}

export function chatKey(id, chatId) {
  return `projects/${id}/.agent/chats/${chatId}.json`;
}

export function chatsPrefix(id) {
  return `projects/${id}/.agent/chats/`;
}
