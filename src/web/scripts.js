let currentUser = null;
let selectedGroup = new Set(['all']); 
const groupSelections = new Map();


document.addEventListener('DOMContentLoaded', () => {
    const modal = new bootstrap.Modal(document.getElementById('usernameModal'));
    modal.show();
    
    document.getElementById('submitUsername').addEventListener('click', registerUser);
    document.getElementById('usernameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') registerUser();
    });

    document.getElementById('sendButton').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('logoutButton').addEventListener('click', logoutUser);
});


function registerUser() {
    const username = document.getElementById('usernameInput').value.trim();
    if (!username) return alert("El nombre de usuario no puede estar vacío.");

    const xml = `<UserRequest><name>${username}</name></UserRequest>`;
    
    fetch('/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/xml'},
        body: xml
    })
    .then(response => response.text())
    .then(str => (new DOMParser()).parseFromString(str, "text/xml"))
    .then(xmlResponse => {
        const status = xmlResponse.getElementsByTagName('status')[0].textContent;
        if (status === 'OK') {
            currentUser = username;
            document.getElementById('currentUserDisplay').textContent = username;
            document.getElementById('logoutButton').style.display = 'block';
            document.title = `${username} - Chat`;

            bootstrap.Modal.getInstance(document.getElementById('usernameModal')).hide();
            
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            
            document.body.classList.remove('modal-open');
            document.body.style.overflow = 'auto';
            
            initializeChat();
        }
    })
    .catch(error => console.error('Error en el registro:', error));
}

function sendMessage() {
    const message = document.getElementById('messageInput').value.trim();
    if (!message) return;
    
    if (selectedGroup.size === 0 || (selectedGroup.has('all') && selectedGroup.size > 1)) {
        alert("Selección invalida. Debe seleccionar al menos un usuario o 'Todos'.");
        return;
    }

    const recipients = Array.from(selectedGroup).join(',');
    const xml = `<Message>
        <from>${currentUser}</from>
        <to>${recipients}</to>
        <text>${message}</text>
    </Message>`;

    fetch('/api/send', {
        method: 'POST',
        headers: {'Content-Type': 'application/xml'},
        body: xml
    }).then(() => {
        document.getElementById('messageInput').value = '';
        updateMessages();
    }).catch(console.error);
}

function updateUserList() {
    if (!currentUser) return;
    
    fetch('/api/users?forceRefresh=' + Date.now())
        .then(response => response.text())
        .then(str => {
            const xml = new DOMParser().parseFromString(str, "text/xml");
            const users = Array.from(xml.getElementsByTagName("user"))
                            .map(node => node.textContent);
            refreshUserListUI(users);
        })
        .catch(console.error);
}

function refreshUserListUI(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    const todosItem = document.createElement('li');
    todosItem.className = `list-group-item ${selectedGroup.has('all') ? 'active' : ''}`;
    todosItem.innerHTML = `<i class="fas fa-users me-2"></i>Todos`;
    todosItem.addEventListener('click', () => {
        selectedGroup.clear();
        selectedGroup.add('all');
        groupSelections.clear();
        updateSelectedUserHeader();
        updateMessages();
    });
    userList.appendChild(todosItem);

    users.forEach(user => {
        if (user === currentUser) return;
        
        const li = document.createElement('li');
        li.className = 'list-group-item';
        const isSelected = groupSelections.get(user) || false;
        
        li.innerHTML = `
            <input type="checkbox" class="form-check-input" 
                   ${isSelected ? 'checked' : ''} 
                   id="user-${user}">
            <label class="form-check-label" for="user-${user}">${user}</label>
        `;

        const checkbox = li.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedGroup.delete('all');
                selectedGroup.add(user);
                groupSelections.set(user, true);
            } else {
                selectedGroup.delete(user);
                groupSelections.set(user, false);
            }
            updateSelectedUserHeader();
            updateMessages();
        });

        userList.appendChild(li);
    });
}

function handleUserSelection(user, isChecked) {
    if (isChecked) {
        selectedGroup.delete('all');
        selectedGroup.add(user);
        groupSelections.set(user, true);
    } else {
        selectedGroup.delete(user);
        groupSelections.set(user, false);
    }
    updateSelectedUserHeader();
    updateMessages();
}

function checkSelectedUserValidity(users) {
    if (selectedUser && selectedUser !== 'Todos' && !users.includes(selectedUser)) {
        selectedUser = null;
        document.getElementById('messages').innerHTML = 
            '<div class="alert alert-info">El usuario seleccionado ya no está disponible</div>';
        updateSelectedUserHeader();
    }
}

function updateMessages() {
    if (!currentUser) return;

    const target = selectedGroup.has('all') 
        ? 'all' 
        : Array.from(selectedGroup).join(',');
    
    const messagesDiv = document.getElementById('messages');
    
    fetch(`/api/messages?user1=${currentUser}&user2=${target}&_=${Date.now()}`)
    .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
    })
    .then(xmlString => {
        if (xmlString === '<messages/>') {
            messagesDiv.innerHTML = '<div class="no-messages">No hay mensajes</div>';
            return;
        }
        displayMessages(xmlString);
    })
    .catch(error => {
        console.error('Error:', error);
        messagesDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    });
}

function displayMessages(xmlString) {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const messages = xmlDoc.getElementsByTagName('message');

        const isGroupChat = selectedGroup.size > 1 || (selectedGroup.has('all') && selectedGroup.size === 1);

        Array.from(messages).forEach(msg => {
            const from = msg.querySelector('from')?.textContent || 'Unknown';
            const text = msg.querySelector('text')?.textContent || '';
            const isCurrentUser = from === currentUser;

            const messageHTML = formatMessage(`${from}: ${text}`, isCurrentUser, isGroupChat);

            messagesDiv.innerHTML += messageHTML;
        });

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('Error:', error);
        messagesDiv.innerHTML = '<div class="error">Error displaying messages</div>';
    }
}


function evaluateXPath(node, tagName) {
    const result = node.ownerDocument.evaluate(
        `./${tagName}`,
        node,
        null,
        XPathResult.STRING_TYPE,
        null
    );
    return result.stringValue.trim() || (tagName === 'from' ? 'Unknown' : 'Mensaje vacío');
}

function formatMessage(msg, isCurrentUser, isGroupChat = false) {
    if (!msg.includes(':')) {
        console.warn('Malformed message:', msg);
        return `<div class="message-bubble other-message">${msg}</div>`;
    }

    const colonIndex = msg.indexOf(':');
    const sender = msg.substring(0, colonIndex).trim();
    let content = msg.substring(colonIndex + 1).trim();

    const isBroadcast = content.startsWith('[Broadcast]');
    if (isBroadcast) {
        content = content.replace('[Broadcast]', '').trim();
    }

    const showLabel = isGroupChat && !isCurrentUser;

    return `
        <div class="message-container">
            <div class="message-bubble ${isCurrentUser ? 'user-message' : 'other-message'}">
                <div class="message-info">
                    ${showLabel ? `<span class="sender-label">${sender}</span>` : ''}
                    ${isBroadcast ? '<span class="badge bg-warning">Broadcast</span>' : ''}
                </div>
                <div class="message-text">${content}</div>
            </div>
        </div>
    `;
}

function createUserListItem(username) {
  const li = document.createElement('li');
  li.className = 'list-group-item';
  li.innerHTML = `
    <input type="checkbox" class="form-check-input user-checkbox" id="user-${username}">
    <label class="form-check-label" for="user-${username}">${username}</label>
  `;

  const checkbox = li.querySelector('.user-checkbox');
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedUsers.add(username);
    } else {
      selectedUsers.delete(username);
    }
    updateSelectedUserHeader();
  });

  return li;
}

function updateSelectedUserHeader() {
    const headerElement = document.getElementById('selected-user-name');
    headerElement.textContent = selectedGroup.has('all') 
        ? 'Todos' 
        : Array.from(selectedGroup).join(', ');
}

function logoutUser() {
    if (!currentUser) return;
     
    fetch('/api/unregister', {
        method: 'POST',
        headers: {'Content-Type': 'application/xml'},
        body: `<UserRequest><name>${currentUser}</name></UserRequest>`
    })
    .then(() => {
        return fetch('/api/notify-logout', {
            method: 'POST',
            headers: {'Content-Type': 'application/xml'},
            body: `<LogoutNotification><username>${currentUser}</username></LogoutNotification>`
        });
    })
    .then(() => updateUserList())
    .catch(console.error)
    .finally(() => {
        currentUser = null;
        document.getElementById('currentUserDisplay').textContent = 'Sin Usuario';
        document.getElementById('logoutButton').style.display = 'none';
        document.title = 'Chat Cliente';
        new bootstrap.Modal(document.getElementById('usernameModal')).show();
    });
}

function initializeChat() {
    selectedGroup.clear();
    selectedGroup.add('all');
    groupSelections.clear();

    setInterval(updateUserList, 3000);
    setInterval(updateMessages, 1500);
    updateSelectedUserHeader();
    updateUserList();
    updateMessages(); 
}