// Global variables
let socket;
let map;
let markers = [];
let myLocation = null;
let currentRole = null;
let currentName = null;
let isSharing = false;
let currentRequest = null;
let routePolyline = null;
let directionsService = null;
let directionsRenderer = null;
let routeInfo = null;
let myMarker = null; // Add this to track user's own marker

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    try {
        socket = io();
        
        // Socket event listeners
        socket.on('role-selected', function(data) {
            currentRole = data.role;
            currentName = data.name;
            showMainApp();
        });
        
        socket.on('location-shared', function(data) {
            // Only add other users' locations, not your own
            if (data.id !== socket.id) {
                addLocationToMap(data);
                updateLocationsList();
            }
        });
        
        socket.on('locations-data', function(locations) {
            clearMap();
            // Filter out your own location
            const otherLocations = locations.filter(loc => loc.id !== socket.id);
            otherLocations.forEach(location => {
                addLocationToMap(location);
            });
            updateLocationsList();
        });
        
        socket.on('user-offline', function(data) {
            removeLocationFromMap(data.id);
            updateLocationsList();
        });
        
        socket.on('new-request', function(data) {
            showRequestNotification(data);
        });
        
        socket.on('request-created', function(data) {
            currentRequest = data;
            showMessage('Booking request sent! Waiting for service provider...', 'success');
            updateRequestUI();
        });
        
        socket.on('request-accepted', function(data) {
            currentRequest = { ...currentRequest, status: 'accepted', ...data };
            showMessage('Booking request accepted! Route calculated.', 'success');
            showRapidoStyleRoute(data.userLat, data.userLng, data.workerLat, data.workerLng);
            updateRequestUI();
        });
        
        socket.on('request-cancelled', function(data) {
            currentRequest = null;
            clearRoute();
            hideRoutePanel();
            showMessage('Booking request cancelled', 'success');
            updateRequestUI();
        });
        
        socket.on('error', function(data) {
            showMessage(data.message, 'error');
        });
        
        socket.on('connect', function() {
            console.log('Connected to server');
        });
        
        socket.on('disconnect', function() {
            console.log('Disconnected from server');
        });
        
    } catch (error) {
        console.error('Error initializing app:', error);
        showMessage('Error connecting to server. Please refresh the page.', 'error');
    }
});

function selectRole(role) {
    const name = prompt(`Enter your name for ${role} role:`);
    if (name && name.trim()) {
        socket.emit('select-role', { role, name: name.trim() });
    }
}

function showMainApp() {
    document.getElementById('roleSelection').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    document.getElementById('userRole').textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);
    document.getElementById('userName').textContent = currentName;
    
    const otherRole = currentRole === 'user' ? 'worker' : 'user';
    document.getElementById('otherRoleTitle').textContent = otherRole === 'worker' ? '👷 Service Providers' : '👤 Customers';
    
    getCurrentLocation();
    loadOtherLocations();
    updateRequestUI();
}

function getCurrentLocation() {
    const locationDisplay = document.getElementById('myLocation');
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;
                
                myLocation = { lat, lng, accuracy };
                
                locationDisplay.innerHTML = `
                    <div class="location-item">
                        <strong>Latitude:</strong>
                        <span>${lat.toFixed(6)}</span>
                    </div>
                    <div class="location-item">
                        <strong>Longitude:</strong>
                        <span>${lng.toFixed(6)}</span>
                    </div>
                    <div class="location-item">
                        <strong>Accuracy:</strong>
                        <span>${accuracy.toFixed(0)}m</span>
                    </div>
                    <div class="location-item">
                        <strong>Status:</strong>
                        <span class="${isSharing ? 'status-online' : 'status-offline'}">
                            ${isSharing ? 'Sharing' : 'Not Sharing'}
                        </span>
                    </div>
                `;
                
                // Update location status
                const statusElement = document.getElementById('locationStatus');
                statusElement.innerHTML = `<span class="${isSharing ? 'status-online' : 'status-offline'}">${isSharing ? 'Location shared' : 'Location not shared'}</span>`;
                
                // Add your own location to the map
                addMyLocationToMap();
                
                if (isSharing) {
                    socket.emit('location-update', { latitude: lat, longitude: lng, accuracy });
                }
            },
            function(error) {
                console.error('Geolocation error:', error);
                locationDisplay.innerHTML = `
                    <div class="error">
                        <h3>❌ Location Access Denied</h3>
                        <p>Please enable location access to use this feature.</p>
                        <button class="btn btn-primary" onclick="getCurrentLocation()">Try Again</button>
                    </div>
                `;
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    } else {
        locationDisplay.innerHTML = `
            <div class="error">
                <h3>❌ Geolocation Not Supported</h3>
                <p>Your browser doesn't support geolocation.</p>
            </div>
        `;
    }
}

function addMyLocationToMap() {
    if (!map || !myLocation) return;
    
    // Remove existing my marker
    if (myMarker) {
        myMarker.setMap(null);
    }
    
    // Add your location marker with a special style
    myMarker = new google.maps.Marker({
        position: { lat: myLocation.lat, lng: myLocation.lng },
        map: map,
        title: `${currentName} (You - ${currentRole})`,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="22" fill="#667eea" stroke="#fff" stroke-width="6"/>
                    <circle cx="25" cy="25" r="12" fill="#fff"/>
                    <text x="25" y="30" text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="#667eea">YOU</text>
                </svg>
            `),
            scaledSize: new google.maps.Size(50, 50),
            anchor: new google.maps.Point(25, 25)
        }
    });
    
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 10px; text-align: center;">
                <h3 style="margin: 0 0 5px 0; color: #333;"> You (${currentRole})</h3>
                <p style="margin: 0; color: #666; font-size: 0.9rem;">
                    Lat: ${myLocation.lat.toFixed(6)}<br>
                    Lng: ${myLocation.lng.toFixed(6)}<br>
                    Accuracy: ${myLocation.accuracy.toFixed(0)}m
                </p>
            </div>
        `
    });
    
    myMarker.addListener('click', function() {
        infoWindow.open(map, myMarker);
    });
    
    // Center map on your location
    map.setCenter({ lat: myLocation.lat, lng: myLocation.lng });
    map.setZoom(15);
}

function startLocationSharing() {
    if (!myLocation) {
        showMessage('Please wait for your location to be detected first.', 'error');
        return;
    }
    
    isSharing = true;
    socket.emit('location-update', {
        latitude: myLocation.lat,
        longitude: myLocation.lng,
        accuracy: myLocation.accuracy
    });
    
    showMessage('Location sharing started!', 'success');
    getCurrentLocation();
    loadOtherLocations();
}

function stopLocationSharing() {
    isSharing = false;
    showMessage('Location sharing stopped.', 'success');
    getCurrentLocation();
}

function loadOtherLocations() {
    const otherRole = currentRole === 'user' ? 'worker' : 'user';
    socket.emit('get-locations', otherRole);
}

function addLocationToMap(location) {
    if (!map) {
        console.error('Map not initialized');
        return;
    }
    
    // Skip if this is your own location
    if (location.id === socket.id) {
        return;
    }
    
    // Remove existing marker for this location
    removeLocationFromMap(location.id);
    
    const marker = new google.maps.Marker({
        position: { lat: location.latitude, lng: location.longitude },
        map: map,
        title: `${location.name} (${location.role})`,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="20" cy="20" r="18" fill="${location.role === 'user' ? '#e74c3c' : '#28a745'}" stroke="#fff" stroke-width="4"/>
                    <circle cx="20" cy="20" r="8" fill="#fff"/>
                </svg>
            `),
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20)
        }
    });
    
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 10px; text-align: center;">
                <h3 style="margin: 0 0 5px 0; color: #333;">${location.role === 'user' ? '👤' : ''} ${location.name}</h3>
                <p style="margin: 0; color: #666; font-size: 0.9rem;">
                    Role: ${location.role}<br>
                    Lat: ${location.latitude.toFixed(6)}<br>
                    Lng: ${location.longitude.toFixed(6)}
                </p>
                ${currentRole === 'user' && location.role === 'worker' ? 
                    `<button class="btn btn-small btn-primary" onclick="sendBookingRequest('${location.id}', '${location.name}')" style="margin-top: 10px;">Send Booking Request</button>` : 
                    ''
                }
                ${currentRole === 'worker' && location.role === 'user' ? 
                    `<button class="btn btn-small btn-success" onclick="acceptBookingRequest('${location.id}', '${location.name}')" style="margin-top: 10px;">Accept Request</button>` : 
                    ''
                }
            </div>
        `
    });
    
    marker.addListener('click', function() {
        infoWindow.open(map, marker);
    });
    
    markers.push({ id: location.id, marker, infoWindow });
    
    // Fit map to show all markers including your location
    fitMapToAllMarkers();
    updateMapInfo();
}

function fitMapToAllMarkers() {
    if (markers.length === 0 && !myMarker) return;
    
    const bounds = new google.maps.LatLngBounds();
    
    // Add your location to bounds
    if (myMarker) {
        bounds.extend(myMarker.getPosition());
    }
    
    // Add other markers to bounds
    markers.forEach(m => bounds.extend(m.marker.getPosition()));
    
    // Fit map to show all markers
    map.fitBounds(bounds);
    
    // Ensure minimum zoom level
    const listener = google.maps.event.addListener(map, 'idle', function() {
        if (map.getZoom() > 15) map.setZoom(15);
        google.maps.event.removeListener(listener);
    });
}

function sendBookingRequest(workerId, workerName) {
    if (!myLocation) {
        showMessage('Please enable location sharing first.', 'error');
        return;
    }
    
    if (confirm(`Send booking request to ${workerName}?`)) {
        socket.emit('create-request', { workerId });
        showMessage(`Booking request sent to ${workerName}!`, 'success');
    }
}

function acceptBookingRequest(userId, userName) {
    if (confirm(`Accept booking request from ${userName}?`)) {
        // This will be handled by the server when a request is created
        showMessage(`Booking request accepted from ${userName}!`, 'success');
    }
}

function showRequestNotification(data) {
    if (currentRole === 'worker') {
        const notification = document.createElement('div');
        notification.className = 'request-notification';
        notification.innerHTML = `
            <div class="request-content">
                <h3>New Booking Request from ${data.userName}</h3>
                <p>Location: ${data.userLat.toFixed(4)}, ${data.userLng.toFixed(4)}</p>
                <div class="request-actions">
                    <button class="btn btn-success" onclick="acceptRequestById(${data.requestId})">Accept</button>
                    <button class="btn btn-secondary" onclick="dismissNotification(this)">Dismiss</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 30000);
    }
}

function acceptRequestById(requestId) {
    socket.emit('accept-request', { requestId });
    dismissNotification(document.querySelector('.request-notification'));
}

function dismissNotification(element) {
    if (element && element.parentNode) {
        element.remove();
    }
}

function showRapidoStyleRoute(userLat, userLng, workerLat, workerLng) {
    if (!map || !directionsService || !directionsRenderer) return;
    
    // Clear existing route
    clearRoute();
    
    // Calculate route
    directionsService.route({
        origin: { lat: userLat, lng: userLng },
        destination: { lat: workerLat, lng: workerLng },
        travelMode: google.maps.TravelMode.DRIVING
    }, function(result, status) {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
            routePolyline = directionsRenderer;
            
            // Get route details
            const route = result.routes[0];
            const leg = route.legs[0];
            const distance = leg.distance.text;
            const duration = leg.duration.text;
            const startAddress = leg.start_address;
            const endAddress = leg.end_address;
            
            // Store route info
            routeInfo = {
                distance: leg.distance.value, // in meters
                duration: leg.duration.value, // in seconds
                distanceText: distance,
                durationText: duration,
                startAddress: startAddress,
                endAddress: endAddress,
                steps: leg.steps
            };
            
            // Show Rapido-style route panel
            showRapidoRoutePanel();
            
            // Fit map to show the route
            const bounds = new google.maps.LatLngBounds();
            leg.steps.forEach(step => {
                bounds.extend(step.start_location);
                bounds.extend(step.end_location);
            });
            map.fitBounds(bounds);
            
            showMessage(`Route calculated: ${distance} (${duration})`, 'success');
        } else {
            console.error('Directions request failed:', status);
            showMessage('Failed to calculate route', 'error');
        }
    });
}

function showRapidoRoutePanel() {
    // Remove existing route panel
    const existingPanel = document.getElementById('rapidoRoutePanel');
    if (existingPanel) {
        existingPanel.remove();
    }
    
    // Create Rapido-style route panel
    const routePanel = document.createElement('div');
    routePanel.id = 'rapidoRoutePanel';
    routePanel.className = 'rapido-route-panel';
    
    const estimatedFare = calculateFare(routeInfo.distance, routeInfo.duration);
    
    routePanel.innerHTML = `
        <div class="route-header">
            <div class="route-title">
                <h3>🚗 Route to Destination</h3>
                <button class="close-btn" onclick="hideRoutePanel()">×</button>
            </div>
        </div>
        
        <div class="route-content">
            <div class="route-info">
                <div class="route-distance">
                    <div class="info-item">
                        <span class="icon">📏</span>
                        <div class="info-text">
                            <span class="label">Distance</span>
                            <span class="value">${routeInfo.distanceText}</span>
                        </div>
                    </div>
                    <div class="info-item">
                        <span class="icon">⏱️</span>
                        <div class="info-text">
                            <span class="label">Duration</span>
                            <span class="value">${routeInfo.durationText}</span>
                        </div>
                    </div>
                </div>
                
                <div class="route-addresses">
                    <div class="address-item">
                        <div class="address-marker pickup">📍</div>
                        <div class="address-text">
                            <span class="address-label">Pickup</span>
                            <span class="address-value">${routeInfo.startAddress}</span>
                        </div>
                    </div>
                    <div class="address-item">
                        <div class="address-marker destination">🏁</div>
                        <div class="address-text">
                            <span class="address-label">Destination</span>
                            <span class="address-value">${routeInfo.endAddress}</span>
                        </div>
                    </div>
                </div>
                
                <div class="fare-estimate">
                    <div class="fare-item">
                        <span class="fare-label">Estimated Fare</span>
                        <span class="fare-value">₹${estimatedFare}</span>
                    </div>
                </div>
            </div>
            
            <div class="route-actions">
                <button class="btn btn-primary" onclick="startNavigation()">Start Navigation</button>
                <button class="btn btn-secondary" onclick="shareRoute()">Share Route</button>
                <button class="btn btn-danger" onclick="cancelRoute()">Cancel Route</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(routePanel);
    
    // Animate the panel
    setTimeout(() => {
        routePanel.classList.add('show');
    }, 100);
}

function calculateFare(distanceMeters, durationSeconds) {
    // Simple fare calculation (similar to Rapido)
    const baseFare = 20;
    const perKmRate = 8;
    const perMinuteRate = 1;
    
    const distanceKm = distanceMeters / 1000;
    const durationMinutes = durationSeconds / 60;
    
    const fare = baseFare + (distanceKm * perKmRate) + (durationMinutes * perMinuteRate);
    return Math.round(fare);
}

function hideRoutePanel() {
    const routePanel = document.getElementById('rapidoRoutePanel');
    if (routePanel) {
        routePanel.classList.remove('show');
        setTimeout(() => {
            routePanel.remove();
        }, 300);
    }
}

function startNavigation() {
    if (routeInfo) {
        // Open Google Maps navigation
        const startLat = myLocation ? myLocation.lat : routeInfo.steps[0].start_location.lat();
        const startLng = myLocation ? myLocation.lng : routeInfo.steps[0].start_location.lng();
        const endLat = routeInfo.steps[routeInfo.steps.length - 1].end_location.lat();
        const endLng = routeInfo.steps[routeInfo.steps.length - 1].end_location.lng();
        
        const navUrl = `https://www.google.com/maps/dir/${startLat},${startLng}/${endLat},${endLng}`;
        window.open(navUrl, '_blank');
    }
}

function shareRoute() {
    if (routeInfo) {
        const shareText = `Check out this route: ${routeInfo.distanceText} (${routeInfo.durationText})`;
        const shareUrl = window.location.href;
        
        if (navigator.share) {
            navigator.share({
                title: 'Route Information',
                text: shareText,
                url: shareUrl
            });
        } else {
            // Fallback to clipboard
            navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
            showMessage('Route information copied to clipboard!', 'success');
        }
    }
}

function cancelRoute() {
    clearRoute();
    hideRoutePanel();
    if (currentRequest) {
        socket.emit('cancel-request', { requestId: currentRequest.requestId });
    }
}

function clearRoute() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
    routeInfo = null;
}

function updateRequestUI() {
    const requestCard = document.getElementById('requestCard');
    const requestSection = document.getElementById('requestSection');
    
    if (currentRequest) {
        requestCard.style.display = 'block';
        requestSection.innerHTML = `
            <div class="request-status">
                <h3>Current Booking Request</h3>
                <p>Status: <span class="status-${currentRequest.status}">${currentRequest.status.toUpperCase()}</span></p>
                ${currentRequest.status === 'pending' ? 
                    '<button class="btn btn-danger" onclick="cancelRequest()">Cancel Request</button>' : 
                    '<button class="btn btn-secondary" onclick="clearRequest()">Clear</button>'
                }
            </div>
        `;
    } else {
        requestCard.style.display = 'none';
        requestSection.innerHTML = '<p class="no-data">No active requests</p>';
    }
}

function cancelRequest() {
    if (currentRequest) {
        socket.emit('cancel-request', { requestId: currentRequest.requestId });
    }
}

function clearRequest() {
    currentRequest = null;
    clearRoute();
    hideRoutePanel();
    updateRequestUI();
}

function removeLocationFromMap(locationId) {
    const index = markers.findIndex(m => m.id === locationId);
    if (index !== -1) {
        markers[index].marker.setMap(null);
        if (markers[index].infoWindow) {
            markers[index].infoWindow.close();
        }
        markers.splice(index, 1);
        fitMapToAllMarkers();
        updateMapInfo();
    }
}

function clearMap() {
    markers.forEach(m => {
        m.marker.setMap(null);
        if (m.infoWindow) {
            m.infoWindow.close();
        }
    });
    markers = [];
    
    if (myMarker) {
        myMarker.setMap(null);
        myMarker = null;
    }
    
    clearRoute();
    hideRoutePanel();
    updateMapInfo();
}

function centerOnMyLocation() {
    if (myLocation && map) {
        map.setCenter({ lat: myLocation.lat, lng: myLocation.lng });
        map.setZoom(15);
    } else {
        showMessage('Please enable location sharing first.', 'error');
    }
}

function updateMapInfo() {
    const count = markers.length + (myMarker ? 1 : 0);
    document.getElementById('activeCount').textContent = count;
    const mapInfoElement = document.getElementById('mapInfo');
    if (mapInfoElement) {
        mapInfoElement.style.display = count > 0 ? 'block' : 'none';
    }
}

function updateLocationsList() {
    const container = document.getElementById('otherLocations');
    if (!container) return;
    
    // Create list including your own location
    let allLocations = [];
    
    // Add your location if sharing
    if (isSharing && myLocation) {
        allLocations.push({
            id: 'my-location',
            name: `${currentName} (You)`,
            role: currentRole,
            position: { lat: () => myLocation.lat, lng: () => myLocation.lng }
        });
    }
    
    // Add other locations
    markers.forEach(m => {
        allLocations.push({
            id: m.id,
            name: m.marker.getTitle(),
            role: m.marker.getTitle().includes('user') ? 'user' : 'worker',
            position: m.marker.getPosition()
        });
    });
    
    if (allLocations.length === 0) {
        container.innerHTML = '<p class="no-data">No locations available</p>';
        return;
    }
    
    container.innerHTML = allLocations.map(location => `
        <div class="location-entry">
            <div class="location-entry-info">
                <div class="location-entry-name">${location.name}</div>
                <div class="location-entry-coords">
                    ${location.position.lat().toFixed(6)}, ${location.position.lng().toFixed(6)}
                </div>
            </div>
            <div class="location-entry-actions">
                <button class="btn btn-small btn-primary" onclick="centerOnLocation('${location.id}')">View</button>
            </div>
        </div>
    `).join('');
}

function centerOnLocation(locationId) {
    if (locationId === 'my-location' && myMarker) {
        map.setCenter(myMarker.getPosition());
        map.setZoom(15);
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px; text-align: center;">
                    <h3 style="margin: 0 0 5px 0; color: #333;"> You (${currentRole})</h3>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">
                        Lat: ${myLocation.lat.toFixed(6)}<br>
                        Lng: ${myLocation.lng.toFixed(6)}<br>
                        Accuracy: ${myLocation.accuracy.toFixed(0)}m
                    </p>
                </div>
            `
        });
        infoWindow.open(map, myMarker);
        return;
    }
    
    const markerData = markers.find(m => m.id === locationId);
    if (markerData) {
        map.setCenter(markerData.marker.getPosition());
        map.setZoom(15);
        markerData.infoWindow.open(map, markerData.marker);
    }
}

function initMap() {
    try {
        map = new google.maps.Map(document.getElementById('map'), {
            zoom: 10,
            center: { lat: 0, lng: 0 },
            mapTypeId: 'roadmap',
            styles: [
                {
                    featureType: 'poi',
                    elementType: 'labels',
                    stylers: [{ visibility: 'off' }]
                }
            ]
        });
        
        // Initialize directions service
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
            suppressMarkers: true,
            polylineOptions: {
                strokeColor: '#667eea',
                strokeWeight: 4,
                strokeOpacity: 0.8
            }
        });
        
        directionsRenderer.setMap(map);
        
        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Error initializing map:', error);
        showMessage('Error initializing map. Please check your Google Maps API key.', 'error');
    }
}

function showMessage(message, type) {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.message');
    existingMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.position = 'fixed';
    messageDiv.style.top = '20px';
    messageDiv.style.right = '20px';
    messageDiv.style.zIndex = '10000';
    messageDiv.style.padding = '1rem';
    messageDiv.style.borderRadius = '10px';
    messageDiv.style.color = 'white';
    messageDiv.style.fontWeight = '500';
    messageDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    
    if (type === 'success') {
        messageDiv.style.background = '#28a745';
    } else {
        messageDiv.style.background = '#dc3545';
    }
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Handle API key error
window.gm_authFailure = function() {
    console.error('Google Maps API key error');
    showMessage('Google Maps API key error. Please check your API key.', 'error');
};

// Handle any uncaught errors
window.addEventListener('error', function(e) {
    console.error('Uncaught error:', e.error);
});
