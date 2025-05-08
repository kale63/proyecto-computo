let currentUser = null;
let selectedUser = null;

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
    if (!selectedUser || !currentUser) {
        alert("Debes escoger un usuario para enviar un mensaje.");
        return;
    }
    
    const message = document.getElementById('messageInput').value.trim();
    if (!message) return;

    const to = selectedUser === 'Todos' ? 'all' : selectedUser;
    
    const xmlDoc = new DOMParser().parseFromString('<Message/>', 'text/xml');
    const root = xmlDoc.documentElement;
    
    const addElement = (name, value) => {
        const el = xmlDoc.createElement(name);
        el.textContent = value;
        root.appendChild(el);
    };
    
    addElement('from', currentUser);
    addElement('to', to);
    addElement('text', message);
    
    const xml = new XMLSerializer().serializeToString(xmlDoc);
    console.log("Enviando XML:", xml); // para debugging

    fetch('/api/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml'
        },
        body: xml
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                console.error("Respuesta del servidor:", text);
                throw new Error(`HTTP ${response.status}: ${text}`);
            });
        }
        document.getElementById('messageInput').value = '';
        updateMessages();
    })
    .catch(error => {
        console.error('Error de envío:', error);
        alert(`Error al enviar: ${error.message}`);
    });
}

function updateUserList() {
    if (!currentUser) return;
    
    fetch('/api/users?forceRefresh=' + new Date().getTime()) 
        .then(response => response.text())
        .then(str => {
            const xml = new DOMParser().parseFromString(str, "text/xml");
            const users = Array.from(xml.getElementsByTagName("user"))
                .map(node => node.textContent)
                .filter(user => user !== currentUser);
            
            refreshUserListUI(users);
            checkSelectedUserValidity(users);
        })
        .catch(console.error);
}

function refreshUserListUI(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    userList.appendChild(createUserListItem('Todos'));
    
    users.forEach(user => {
        userList.appendChild(createUserListItem(user));
    });
}

function checkSelectedUserValidity(users) {
    if (selectedUser && selectedUser !== 'Todos' && !users.includes(selectedUser)) {
        selectedUser = null;
        document.getElementById('messages').innerHTML = 
            '<div class="alert alert-info">El usuario seleccionado ya no está disponible</div>';
        updateSelectedUserHeader();
    }
}

function formatMessage(msg, isCurrentUser) {
    if (!msg.includes(':')) {
        console.warn('Mensaje mal formado:', msg);
        return `<div class="message-bubble other-message">${msg}</div>`;
    }

    const colonIndex = msg.indexOf(':');
    const sender = msg.substring(0, colonIndex).trim();
    let content = msg.substring(colonIndex + 1).trim();
    
    const isBroadcast = content.startsWith('[Broadcast]');
    if (isBroadcast) {
        content = content.replace('[Broadcast]', '').trim();
    }

    return `
        <div class="message-container">
            <div class="message-bubble ${isCurrentUser ? 'user-message' : 'other-message'}">
                <div class="message-info">
                    ${isBroadcast ? '<span class="badge bg-warning">Broadcast</span>' : ''}
                </div>${content}
            </div>
        </div>
    `;
}

function updateMessages() {
    if (!selectedUser || !currentUser) return;
    
    const targetUser = selectedUser === 'Todos' ? 'all' : selectedUser;
    fetch(`/api/messages?user1=${currentUser}&user2=${targetUser}`)
        .then(response => {
            if (!response.ok) throw new Error('Error de red');
            return response.text();
        })
        .then(str => {
            try {
                const parser = new DOMParser();
                const xml = parser.parseFromString(str, "text/xml");
                
                if (xml.querySelector('parsererror')) {
                    throw new Error('XML invalido recibido');
                }

                const messages = Array.from(xml.getElementsByTagName('message'))
                    .map(node => node.textContent)
                    .filter(msg => msg.trim().length > 0);

                const messagesDiv = document.getElementById('messages');
                messagesDiv.innerHTML = messages
                    .map(msg => {
                        const isCurrentUser = msg.startsWith(currentUser + ':');
                        return formatMessage(msg, isCurrentUser);
                    })
                    .join('');

            } catch (error) {
                console.error('Error al procesar:', error);
                document.getElementById('messages').innerHTML = 
                    `<div class="alert alert-danger">Error al cargar los mensajes</div>`;
            }
        })
        .catch(error => {
            console.error('Fetch error:', error);
        });
}

function createUserListItem(username) {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    li.textContent = username;
    li.addEventListener('click', () => {
        document.querySelectorAll('#userList li').forEach(item => 
            item.classList.remove('active'));
        li.classList.add('active');
        selectedUser = username === 'Todos' ? 'Todos' : username;
        updateSelectedUserHeader();
        updateMessages();
    });
    return li;
}

function updateSelectedUserHeader() {
    const headerElement = document.getElementById('selected-user-name');
    if (selectedUser === 'Todos') {
        headerElement.textContent = 'Todos';
        headerElement.className = 'all-users';
    } else {
        headerElement.textContent = selectedUser;
        headerElement.className = 'specific-user';
    }
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
    setInterval(updateUserList, 3000);
    setInterval(updateMessages, 1500);
    updateSelectedUserHeader();
    updateUserList();
}