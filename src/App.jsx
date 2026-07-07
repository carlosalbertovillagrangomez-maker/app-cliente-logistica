import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Clock, Calendar, Zap, ChevronRight, User, 
  Mail, Lock, Loader2, LogOut, PlusCircle, History, 
  Car, ShieldCheck, CheckCircle, Navigation, Phone, 
  Settings, X, Trash2, BellRing, Briefcase, MessageSquare, Send, CreditCard, CheckCircle2
} from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc, arrayUnion } from 'firebase/firestore';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Autocomplete, Marker, Polyline } from '@react-google-maps/api';

// --- STRIPE ---
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const libraries = ['places', 'geometry'];

// INICIALIZAR STRIPE CON TU LLAVE PÚBLICA
const stripePromise = loadStripe('pk_test_51TSh9M9QuIIjLWZEG2lOhS7Nf8xyMlzZnzL4vSqEbMIwhfBCBbbvhbEbISQFAx9eAgeQBPWHo4xxWQZ3YN1DWMjS0093xZdQv6');

// =========================================================================
// NUEVO: SISTEMA DE ALERTAS SONORAS
// =========================================================================
const playAlertSound = () => {
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(e => console.log("Navegador bloqueó el audio automático"));
    } catch(e) {}
};

// =========================================================================
// COMPONENTE: FORMULARIO DE TARJETA STRIPE
// =========================================================================
const TarjetaForm = ({ clientSecret, customerId, currentUser, onExito }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setCargando(true); setError('');

        const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
            payment_method: {
                card: elements.getElement(CardElement),
                billing_details: { name: currentUser.name, phone: currentUser.phone },
            },
        });

        if (stripeError) {
            setError(stripeError.message);
            setCargando(false);
        } else {
            try {
                await updateDoc(doc(db, "clientes", currentUser.id), {
                    stripeCustomerId: customerId,
                    hasCard: true,
                    paymentMethodId: setupIntent.payment_method
                });
                const updatedUser = { ...currentUser, hasCard: true, stripeCustomerId: customerId };
                localStorage.setItem('client_session', JSON.stringify(updatedUser));
                onExito(updatedUser);
            } catch (err) {
                setError("Error al guardar en la base de datos.");
            }
            setCargando(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-4 border border-slate-300 rounded-xl bg-white shadow-sm">
                <CardElement options={{
                    style: { base: { fontSize: '16px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#ef4444' } }
                }} />
            </div>
            {error && <p className="text-red-500 text-xs font-bold text-center">{error}</p>}
            <button type="submit" disabled={!stripe || cargando} className="w-full bg-orange-500 text-white font-black p-3.5 rounded-xl shadow-lg shadow-orange-500/30 flex justify-center items-center gap-2 active:scale-95 transition hover:bg-orange-600">
                {cargando ? <Loader2 className="w-5 h-5 animate-spin"/> : <><ShieldCheck className="w-5 h-5"/> GUARDAR TARJETA SEGURA</>}
            </button>
            <p className="text-[10px] text-center text-slate-400 font-bold uppercase mt-2">Pagos procesados de forma segura por Stripe Inc.</p>
        </form>
    );
};


// =========================================================================
// COMPONENTE: RADAR 3D CON RASTREO EN VIVO Y FILTRO ESTABILIZADOR
// =========================================================================
const LiveTrackingMap = ({ viaje }) => {
    const mapRef = useRef(null);
    const prevLocRef = useRef(null);
    const [heading, setHeading] = useState(0);

    const handleLoad = useCallback((map) => {
        mapRef.current = map;
        // FIX: Candado de seguridad para evitar PANTALLA BLANCA
        if (viaje.technicalData?.geometry?.length > 0 && !viaje.currentLocation) {
            const bounds = new window.google.maps.LatLngBounds();
            let hasValidPoints = false;
            viaje.technicalData.geometry.forEach(c => {
                if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
                    bounds.extend(c);
                    hasValidPoints = true;
                }
            });
            if (hasValidPoints) map.fitBounds(bounds);
        }
    }, [viaje.technicalData?.geometry, viaje.currentLocation]);

    useEffect(() => {
        if (!viaje.currentLocation || !mapRef.current) return;
        const loc = viaje.currentLocation;

        mapRef.current.panTo(loc);
        mapRef.current.setZoom(18); 
        mapRef.current.setTilt(60);

        if (prevLocRef.current && window.google?.maps?.geometry) {
            const p1 = new window.google.maps.LatLng(prevLocRef.current.lat, prevLocRef.current.lng);
            const p2 = new window.google.maps.LatLng(loc.lat, loc.lng);
            const dist = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
            if (dist > 3) { 
                const newHeading = window.google.maps.geometry.spherical.computeHeading(p1, p2);
                setHeading(newHeading);
                mapRef.current.setHeading(newHeading);
                prevLocRef.current = loc;
            }
        } else {
            prevLocRef.current = loc;
        }
    }, [viaje.currentLocation]);

    return (
        <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={viaje.currentLocation || viaje.startCoords || { lat: 19.4326, lng: -99.1332 }}
            zoom={14}
            onLoad={handleLoad}
            options={{ 
                disableDefaultUI: true, 
                mapId: "73f56298887c80075f6fc648",
                gestureHandling: "greedy" 
            }}
        >
            {viaje.technicalData?.geometry && <Polyline path={viaje.technicalData.geometry} options={{ strokeColor: '#f97316', strokeOpacity: 0.9, strokeWeight: 6 }} />}
            {viaje.currentLocation ? (
                <Marker position={viaje.currentLocation} icon={{ path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: '#22c55e', fillOpacity: 1, strokeWeight: 2, strokeColor: 'white', rotation: heading }} zIndex={999} />
            ) : (
                viaje.startCoords && <Marker position={viaje.startCoords} label="A" />
            )}
            {viaje.endCoords && <Marker position={viaje.endCoords} label="B" />}
        </GoogleMap>
    );
};
// =========================================================================

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pedir');
  const [isEditingProfile, setIsEditingProfile] = useState(false); 

  // --- Formularios (SIN EMAIL) ---
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState('Individual'); 
  const [error, setError] = useState('');

  // --- Formulario de Pedido ---
  const [origen, setOrigen] = useState('');
  const [origenCoords, setOrigenCoords] = useState(null); 
  const [destino, setDestino] = useState('');
  const [destinoCoords, setDestinoCoords] = useState(null); 
  const [tipoServicio, setTipoServicio] = useState('Prioritario');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');

  // --- Datos ---
  const [misViajes, setMisViajes] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const [activeChatTripId, setActiveChatTripId] = useState(null);
  const [chatText, setChatText] = useState('');
  const chatScrollRef = useRef(null);
  
  // Ref para detectar cambios y hacer sonar la alerta
  const prevTripsRef = useRef({});

  // --- Billetera ---
  const [clientSecret, setClientSecret] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [iniciandoStripe, setIniciandoStripe] = useState(false);

  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries });
  const originRef = useRef(null);
  const destRef = useRef(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('client_session');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setCurrentUser(parsedUser);
        cargarDatosPerfil(parsedUser);
        if (parsedUser && parsedUser.name) escucharMisViajes(parsedUser.name); 
      } catch(e) { localStorage.removeItem('client_session'); }
    }
  }, []);

  const cargarDatosPerfil = (user) => {
    setName(user.name || ''); setPhone(user.phone || ''); 
    setPassword(user.password || '');
    setAccountType(user.type || 'Individual');
  };

  const escucharMisViajes = (clientName) => {
    if (!clientName) return;
    const q = query(collection(db, "rutas"), where("client", "==", clientName));
    onSnapshot(q, (snapshot) => {
      const viajes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      viajes.sort((a, b) => new Date(b.createdDate || 0) - new Date(a.createdDate || 0));
      setMisViajes(viajes);
    });
  };

  // --- CONTROL DE ALERTAS SONORAS ---
  useEffect(() => {
      let shouldRing = false;
      const newState = {};
      
      misViajes.forEach(v => {
          newState[v.id] = { 
              status: v.status, 
              chatLen: v.chat?.length || 0, 
              isArriving: v.proximityAlert?.active 
          };
          
          const prev = prevTripsRef.current[v.id];
          if (prev) {
              // Si nos aceptan el viaje
              if (prev.status === 'Pendiente' && v.status === 'Aceptada') shouldRing = true;
              // Si el chofer manda mensaje
              if (prev.chatLen < (v.chat?.length || 0) && v.chat[v.chat.length - 1].sender !== 'Cliente') shouldRing = true;
              // Si el chofer está llegando
              if (!prev.isArriving && v.proximityAlert?.active) shouldRing = true;
          }
      });

      if (shouldRing) {
          playAlertSound();
          if ("vibrate" in navigator) navigator.vibrate([300, 100, 300]);
      }
      prevTripsRef.current = newState;
  }, [misViajes]);

  const arrivingTrip = misViajes.find(v => v.status === 'En Ruta' && v.proximityAlert?.active && !dismissedAlerts.includes(v.id));

  useEffect(() => {
      if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
  }, [misViajes, activeChatTripId]);

  // --- AUTH POR TELÉFONO ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (isRegistering) {
        if (!name || !phone || !password) throw new Error('Llena todos los campos');

        const qCheck = query(collection(db, "clientes"), where("phone", "==", phone.trim()));
        const snapCheck = await getDocs(qCheck);
        if (!snapCheck.empty) throw new Error('Este número de teléfono ya está registrado.');

        const newUser = { name: name.trim(), phone: phone.trim(), password, role: 'cliente', status: 'Activo', type: accountType, users: [], locations: [], hasCard: false, created: new Date().toISOString(), createdAt: new Date().toISOString(), joined: new Date().toLocaleDateString() };
        const docRef = await addDoc(collection(db, "clientes"), newUser);
        const userData = { id: docRef.id, ...newUser };
        setCurrentUser(userData); localStorage.setItem('client_session', JSON.stringify(userData));
        escucharMisViajes(userData.name);
      } else {
        const q = query(collection(db, "clientes"), where("phone", "==", phone.trim()));
        const snap = await getDocs(q);
        if (snap.empty) throw new Error('Número de teléfono no encontrado');
        const userData = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (userData.password !== password) throw new Error('Contraseña incorrecta');
        setCurrentUser(userData); cargarDatosPerfil(userData); localStorage.setItem('client_session', JSON.stringify(userData));
        escucharMisViajes(userData.name);
      }
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userRef = doc(db, "clientes", currentUser.id);
      const updatedData = { name: name.trim(), phone: phone.trim(), password, type: accountType };
      await updateDoc(userRef, updatedData);
      const updatedUser = { ...currentUser, ...updatedData };
      setCurrentUser(updatedUser);
      localStorage.setItem('client_session', JSON.stringify(updatedUser));
      alert("¡Perfil actualizado con éxito!");
      setIsEditingProfile(false);
    } catch (err) { alert("Error al actualizar perfil."); }
    setLoading(false);
  };

  const handlePedirViaje = async (e) => {
    e.preventDefault();
    
    // Validación temporal: Quitar el comentario de la siguiente línea si quieres OBLIGAR a que tengan tarjeta para pedir viaje
    // if(!isCorporate && !currentUser.hasCard) return alert("Por favor, agrega un método de pago en tu Billetera antes de solicitar un viaje.");

    if (!origen || !destino) return alert("Ingresa origen y destino");
    if (!origenCoords || !destinoCoords) return alert("Selecciona la dirección sugerida por Google Maps.");
    if (tipoServicio === 'Programado' && (!fecha || !hora)) return alert("Ingresa fecha y hora para programar");

    setLoading(true);
    try {
      const directionsService = new window.google.maps.DirectionsService();
      const results = await directionsService.route({
          origin: origenCoords,
          destination: destinoCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
      });
      
      const routeData = results.routes[0];
      // FIX: Obtenemos los valores numéricos para evitar que diga "15 km km" o crashee
      const distanceValue = routeData.legs[0].distance.value; 
      const durationValue = routeData.legs[0].duration.value;
      const distanceKm = (distanceValue / 1000).toFixed(1);
      const durationMin = Math.round(durationValue / 60);
      const geometry = routeData.overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));

      const nuevaRuta = {
        client: currentUser.name || 'Cliente', 
        requestUser: currentUser.phone || '', 
        start: origen, 
        // FIX: Inyectamos el passengerName para que la app del conductor lo vea
        startCoords: { lat: origenCoords.lat, lng: origenCoords.lng, passengerName: currentUser.name, contact: currentUser.phone }, 
        end: destino, 
        endCoords: { lat: destinoCoords.lat, lng: destinoCoords.lng, passengerName: currentUser.name, contact: currentUser.phone }, 
        serviceType: tipoServicio, 
        scheduledDate: tipoServicio === 'Programado' ? fecha : new Date().toISOString().split('T')[0], 
        scheduledTime: tipoServicio === 'Programado' ? hora : new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }), 
        status: 'Pendiente', 
        createdDate: new Date().toISOString(), 
        driverId: '', 
        driver: '', 
        waypoints: [], 
        waypointsData: [], 
        chat: [], 
        technicalData: { 
            totalDistance: distanceKm, 
            totalDuration: durationMin, 
            geometry: geometry 
        }
      };
      
      await addDoc(collection(db, "rutas"), nuevaRuta);
      alert("¡Viaje solicitado con éxito!");
      setOrigen(''); setDestino(''); setOrigenCoords(null); setDestinoCoords(null);
      setActiveTab('historial');
    } catch (err) { 
        console.error(err);
        alert("Error calculando la ruta. Verifica tu conexión o intenta con otra dirección."); 
    }
    setLoading(false);
  };

  const handleCancelarViaje = async (viajeId) => {
      if (!confirm("¿Estás seguro de que deseas cancelar esta solicitud de viaje?")) return;
      try { await updateDoc(doc(db, "rutas", viajeId), { status: 'Cancelado' }); } catch (err) { alert("Error al cancelar el viaje."); }
  };

  const enviarMensajeCliente = async () => {
      if (!chatText.trim() || !activeChatTripId) return;
      const msg = { sender: 'Cliente', text: chatText.trim(), time: new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' }), timestamp: new Date().toISOString() };
      try { await updateDoc(doc(db, "rutas", activeChatTripId), { chat: arrayUnion(msg) }); setChatText(''); } catch(e) { }
  };

  // --- LÓGICA DE BILLETERA ---
  const iniciarVinculacionTarjeta = async () => {
      setIniciandoStripe(true);
      try {
          const response = await fetch('/api/setup-intent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: currentUser.phone, name: currentUser.name }),
          });
          const data = await response.json();
          if (data.clientSecret) {
              setClientSecret(data.clientSecret);
              setCustomerId(data.customerId);
          } else {
              alert("Error al conectar con el servidor bancario.");
          }
      } catch (err) {
          alert("Error de conexión. Verifica tu internet.");
      }
      setIniciandoStripe(false);
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center p-6 font-sans text-slate-800">
        <div className="w-full max-w-sm mx-auto bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="flex justify-center mb-4">
             <img src="/logo.png" alt="TripLogix Logo" className="w-28 h-28 object-contain drop-shadow-md" />
          </div>
          <div className="text-center mb-6">
            <h1 className="text-3xl font-black text-slate-800 uppercase tracking-wider mb-1">
              Trip<span className="text-orange-500">Logix</span>
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              {isRegistering ? 'Crea tu cuenta' : 'Ingresa para pedir un viaje'}
            </p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && (
              <><div className="relative"><User className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="text" placeholder="Nombre completo" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" value={name} onChange={e=>setName(e.target.value)} required /></div><div className="relative"><Briefcase className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><select className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none font-bold text-slate-600 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all" value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="Individual">Cuenta Individual (Personal)</option><option value="Empresa">Cuenta Empresa (Corporativo)</option></select></div></>
            )}
            <div className="relative"><Phone className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="tel" placeholder="WhatsApp / Teléfono" disabled={!isRegistering && loading} className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium disabled:opacity-50" value={phone} onChange={e=>setPhone(e.target.value)} required /></div>
            <div className="relative"><Lock className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="password" placeholder="Contraseña" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
            {error && <p className="text-red-500 text-[10px] font-bold text-center">{error}</p>}
            <button type="submit" disabled={loading} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black py-3.5 rounded-xl shadow-lg shadow-slate-800/30 transition-all uppercase tracking-wide text-sm mt-2 flex items-center justify-center">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isRegistering ? 'REGISTRARSE' : 'INICIAR SESIÓN')}
            </button>
          </form>
          <p className="text-xs text-slate-500 mt-6 text-center font-medium">
            {isRegistering ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '} 
            <button onClick={() => { setIsRegistering(!isRegistering); setError(''); }} type="button" className="text-orange-500 font-bold hover:text-orange-600 transition-colors">
              {isRegistering ? 'Inicia sesión' : 'Regístrate aquí'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  const activeTrips = misViajes.filter(v => v.status === 'En Ruta' || v.status === 'Pendiente' || v.status === 'Aceptada');
  const pastTrips = misViajes.filter(v => v.status !== 'En Ruta' && v.status !== 'Pendiente' && v.status !== 'Aceptada');
  const isCorporate = currentUser?.type === 'Empresa';
  const chatTrip = misViajes.find(v => v.id === activeChatTripId);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col relative">
      
      {activeChatTripId && chatTrip && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
              <div className="bg-slate-50 w-full max-w-sm h-[85vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden border border-slate-200 relative">
                  <div className="bg-slate-800 text-white p-4 flex justify-between items-center shadow-md z-10 shrink-0">
                      <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-white"/></div><div><p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Conductor</p><h2 className="text-sm font-black leading-tight">{chatTrip.driver || 'Asignando...'}</h2></div></div>
                      <button onClick={() => setActiveChatTripId(null)} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 transition"><X className="w-5 h-5"/></button>
                  </div>
                  <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100">
                      <div className="text-center text-[10px] text-slate-400 font-bold mb-4 uppercase">Inicio de Conversación</div>
                      {(chatTrip.chat || []).map((msg, i) => {
                          if (msg.sender === 'Sistema') { return <div key={i} className="text-center"><span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[10px] font-bold shadow-sm">{msg.text}</span></div> }
                          const isClient = msg.sender === 'Cliente';
                          return (
                              <div key={i} className={`flex w-full ${isClient ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] p-3 rounded-2xl shadow-sm relative ${isClient ? 'bg-orange-500 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`}>
                                      <p className={`text-[9px] font-black uppercase mb-1 ${isClient ? 'hidden' : msg.sender === 'Despacho' ? 'text-orange-500' : 'text-slate-400'}`}>{msg.sender}</p>
                                      <p className="text-sm font-medium leading-snug">{msg.text}</p>
                                      <p className={`text-[9px] mt-1 text-right font-bold ${isClient ? 'text-orange-200' : 'text-slate-400'}`}>{msg.time}</p>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
                  <div className="bg-white p-3 border-t border-slate-200 flex items-center gap-2 shrink-0 pb-safe">
                      <input type="text" value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviarMensajeCliente()} placeholder="Escribe un mensaje..." className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-4 py-3 text-sm outline-none focus:border-orange-500 focus:bg-white transition-colors" />
                      <button onClick={enviarMensajeCliente} className="p-3 bg-orange-500 text-white rounded-full shadow-md hover:bg-orange-600 active:scale-95 transition-transform"><Send className="w-5 h-5 ml-1"/></button>
                  </div>
              </div>
          </div>
      )}

      {arrivingTrip && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md animate-in fade-in zoom-in duration-300">
              <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center shadow-2xl border-4 border-orange-500 relative overflow-hidden">
                  <div className="absolute inset-0 bg-orange-500/10 animate-pulse"></div>
                  <div className="relative z-10">
                      <div className="w-24 h-24 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce shadow-xl shadow-orange-500/40 border-4 border-white"><Car className="w-12 h-12 text-orange-600" /></div>
                      <h2 className="text-3xl font-black text-slate-800 tracking-tighter mb-2 uppercase">¡Prepárate!</h2>
                      <p className="text-lg font-bold text-orange-600 mb-6 leading-tight">Tu transporte está llegando en <span className="text-3xl">{arrivingTrip.proximityAlert?.etaMins || 2}</span> min.</p>
                      <button onClick={() => setDismissedAlerts([...dismissedAlerts, arrivingTrip.id])} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black p-4 rounded-2xl shadow-xl active:scale-95 transition-all text-sm tracking-widest flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5"/> ENTENDIDO, VOY SALIENDO</button>
                  </div>
              </div>
          </div>
      )}

      {isEditingProfile && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6"><h2 className="text-lg font-black text-slate-800">Mi Perfil</h2><button onClick={() => setIsEditingProfile(false)} className="p-2 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-full transition"><X className="w-5 h-5"/></button></div>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nombre</label><input type="text" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-orange-500" value={name} onChange={e=>setName(e.target.value)} required /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">WhatsApp</label><input type="tel" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-orange-500" value={phone} onChange={e=>setPhone(e.target.value)} required /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Tipo de Cuenta</label><select className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none font-bold text-slate-600 focus:border-orange-500" value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="Individual">Cuenta Individual (Muestra Precios)</option><option value="Empresa">Cuenta Empresa (Solo Logística)</option></select></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Contraseña</label><input type="text" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-orange-500" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
                    <button type="submit" disabled={loading} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black p-3.5 rounded-xl flex items-center justify-center transition shadow-lg shadow-slate-800/30 mt-2">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'GUARDAR CAMBIOS'}</button>
                </form>
            </div>
        </div>
      )}

      <div className="bg-white p-5 rounded-b-3xl shadow-sm border-b border-slate-200 flex justify-between items-center z-10 relative">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setIsEditingProfile(true)}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm relative overflow-hidden ${isCorporate ? 'bg-slate-800 text-white' : 'bg-orange-100 text-orange-600'}`}>
            {currentUser?.name ? currentUser.name.substring(0,2).toUpperCase() : 'US'}
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Settings className="w-4 h-4 text-white"/></div>
          </div>
          <div><p className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 ${isCorporate ? 'text-slate-800' : 'text-slate-400'}`}>{isCorporate ? <><Briefcase className="w-3 h-3"/> Corporativo</> : <><User className="w-3 h-3"/> Cliente</>}</p><h2 className="text-sm font-black text-slate-800 leading-tight">{currentUser?.name || 'Usuario'}</h2></div>
        </div>
        <button onClick={() => { localStorage.removeItem('client_session'); setCurrentUser(null); }} className="p-2 bg-slate-50 text-slate-500 hover:text-red-500 rounded-full transition"><LogOut className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        
        {/* --- PESTAÑA: PEDIR VIAJE --- */}
        {activeTab === 'pedir' && (
          <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-4">¿A dónde vamos?</h1>
            <form onSubmit={handlePedirViaje} className="space-y-4">
              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 space-y-4">
                {isLoaded ? (
                  <><div className="relative"><div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-green-500 z-10"></div><Autocomplete onLoad={ref => originRef.current = ref} onPlaceChanged={() => { const p = originRef.current?.getPlace(); if (p?.geometry) { setOrigen(p.formatted_address || p.name); setOrigenCoords({ lat: p.geometry.location.lat(), lng: p.geometry.location.lng() }); } }}><input type="text" placeholder="Punto de Origen (Ej. Reforma 222)" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" value={origen} onChange={e => setOrigen(e.target.value)} required /></Autocomplete></div><div className="w-px h-6 bg-slate-200 ml-5 -my-2"></div><div className="relative"><div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-orange-500 z-10"></div><Autocomplete onLoad={ref => destRef.current = ref} onPlaceChanged={() => { const p = destRef.current?.getPlace(); if (p?.geometry) { setDestino(p.formatted_address || p.name); setDestinoCoords({ lat: p.geometry.location.lat(), lng: p.geometry.location.lng() }); } }}><input type="text" placeholder="Punto de Destino (Ej. Polanco)" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" value={destino} onChange={e => setDestino(e.target.value)} required /></Autocomplete></div></>
                ) : <div className="p-4 text-center text-xs text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2"/> Cargando mapas...</div>}
              </div>
              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Tipo de Servicio</p>
                <div className="grid grid-cols-2 gap-3"><div onClick={() => setTipoServicio('Prioritario')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${tipoServicio === 'Prioritario' ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-500'}`}><Zap className="w-6 h-6" /><span className="text-xs font-bold">Lo antes posible</span></div><div onClick={() => setTipoServicio('Programado')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${tipoServicio === 'Programado' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-100 bg-slate-50 text-slate-500'}`}><Calendar className="w-6 h-6" /><span className="text-xs font-bold">Programar</span></div></div>
                {tipoServicio === 'Programado' && (<div className="mt-4 grid grid-cols-2 gap-3 animate-[fadeIn_0.2s_ease-out]"><input type="date" className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-800" value={fecha} onChange={e=>setFecha(e.target.value)} required /><input type="time" className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-800" value={hora} onChange={e=>setHora(e.target.value)} required /></div>)}
              </div>
              <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black p-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-orange-500/20 active:scale-95 transition-all mt-4">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle className="w-5 h-5"/> SOLICITAR VIAJE</>}</button>
            </form>
          </div>
        )}

        {/* --- PESTAÑA: HISTORIAL --- */}
        {activeTab === 'historial' && (
          <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-4">Mis Viajes</h1>
            {misViajes.length === 0 ? (
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 text-center mt-6"><History className="w-12 h-12 text-slate-300 mx-auto mb-3" /><p className="font-bold text-slate-600">Aún no tienes viajes</p><p className="text-xs text-slate-400 mt-1">Tus solicitudes aparecerán aquí.</p></div>
            ) : (
              <div className="space-y-6">
                {activeTrips.map(viaje => {
                    const isArriving = viaje.status === 'En Ruta' && viaje.proximityAlert?.active;
                    const distanciaKm = parseFloat(viaje.technicalData?.totalDistance) || 0;
                    const costoEstimado = (distanciaKm * 15 + 35).toFixed(2); 

                    return (
                        <div key={viaje.id} className={`bg-white rounded-[2rem] shadow-xl overflow-hidden border-2 transition-colors ${isArriving ? 'border-orange-500 shadow-orange-500/20' : 'border-slate-800'}`}>
                            <div className={`p-4 flex justify-between items-center text-white ${isArriving ? 'bg-orange-500' : 'bg-slate-800'}`}>
                                <div className="flex items-center gap-2 font-bold text-sm">
                                    {isArriving ? <BellRing className="w-4 h-4 animate-bounce" /> : <Navigation className="w-4 h-4 animate-pulse" />}
                                    {viaje.status === 'Pendiente' ? 'ASIGNANDO UNIDAD...' : viaje.status === 'Aceptada' ? 'VIAJE ACEPTADO' : isArriving ? '¡CONDUCTOR LLEGANDO!' : 'VIAJE EN CURSO'}
                                </div>
                                <div className="text-[10px] font-black uppercase bg-black/20 px-2 py-1 rounded-lg">{viaje.serviceType}</div>
                            </div>

                            <div className="h-56 bg-slate-200 relative">
                                {isLoaded ? (
                                    <LiveTrackingMap viaje={viaje} />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin"/></div>
                                )}
                            </div>

                            <div className="p-5">
                                {isCorporate ? (
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Briefcase className="w-3 h-3"/> Métrica Corporativa</p>
                                        <div className="flex justify-between items-center">
                                            <div><p className="text-[10px] font-bold text-slate-500 uppercase">Recorrido Total</p><p className="text-2xl font-black text-slate-800">{viaje.technicalData?.totalDistance || '--'} <span className="text-sm font-medium text-slate-500">km</span></p></div>
                                            <div className="w-px h-10 bg-slate-200"></div>
                                            <div className="text-right"><p className="text-[10px] font-bold text-slate-500 uppercase">Llegada Estimada</p><p className="text-2xl font-black text-orange-600">{viaje.technicalData?.totalDuration || '--'} <span className="text-sm font-medium text-orange-500">min</span></p></div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-3">
                                            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500"><User className="w-5 h-5"/></div>
                                            <div><p className="text-[10px] font-black text-slate-400 uppercase">Operador Asignado</p><p className="text-sm font-bold text-slate-800">{viaje.driver || 'Buscando...'}</p></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center bg-orange-50 p-4 rounded-2xl border border-orange-100">
                                            <div><p className="text-[10px] font-black uppercase text-orange-500">Distancia</p><p className="text-xl font-black text-orange-900">{viaje.technicalData?.totalDistance || '--'} <span className="text-sm">km</span></p></div>
                                            <div className="text-right"><p className="text-[10px] font-black uppercase text-orange-500">Llegada en</p><p className="text-xl font-black text-orange-900">{viaje.technicalData?.totalDuration || '--'} <span className="text-sm">min</span></p></div>
                                        </div>
                                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                                            <div className="flex items-center gap-3"><div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500"><User className="w-6 h-6"/></div><div><p className="text-[10px] font-black text-slate-400 uppercase">Tu Conductor</p><p className="text-sm font-bold text-slate-800">{viaje.driver || 'Asignando...'}</p>{viaje.driver && <p className="text-[10px] font-bold text-slate-400 mt-0.5">Unidad Estándar</p>}</div></div>
                                            <div className="text-right"><p className="text-[10px] font-black text-slate-400 uppercase">Tarifa Est.</p><p className="text-2xl font-black text-slate-800">${costoEstimado}</p></div>
                                        </div>
                                    </div>
                                )}
                                {viaje.driver && viaje.status === 'En Ruta' && (
                                    <button onClick={() => setActiveChatTripId(viaje.id)} className="w-full mt-4 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-black p-3.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors relative"><MessageSquare className="w-4 h-4"/> CHATEAR CON EL CONDUCTOR {viaje.chat && viaje.chat.length > 0 && viaje.chat[viaje.chat.length-1].sender !== 'Cliente' && <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-slate-100 animate-pulse"></span>}</button>
                                )}
                                {viaje.status === 'Pendiente' && (
                                    <button onClick={() => handleCancelarViaje(viaje.id)} className="w-full mt-4 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-bold p-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"><Trash2 className="w-4 h-4"/> CANCELAR VIAJE</button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {pastTrips.map(viaje => (
                  <div key={viaje.id} className={`bg-white p-4 rounded-3xl shadow-sm border-2 overflow-hidden ${viaje.status === 'Cancelado' ? 'border-red-200 bg-red-50/30' : 'border-slate-100'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest mb-1 ${viaje.status === 'Finalizado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{viaje.status === 'Cancelado' && <X className="w-3 h-3"/>}{viaje.status === 'Finalizado' && <CheckCircle className="w-3 h-3"/>}{viaje.status}</span>
                        <p className="text-xs font-bold text-slate-400">{viaje.serviceType === 'Programado' ? `${viaje.scheduledDate} a las ${viaje.scheduledTime}` : 'Servicio Prioritario'}</p>
                      </div>
                      {!isCorporate && viaje.status === 'Finalizado' && (
                          <div className="text-right"><p className="text-[10px] font-bold text-slate-400 uppercase">Total</p><p className="text-sm font-black text-slate-800">${((parseFloat(viaje.technicalData?.totalDistance) || 0) * 15 + 35).toFixed(2)}</p></div>
                      )}
                    </div>
                    <div className={`relative pl-3 border-l-2 space-y-3 mb-2 ml-1 ${viaje.status === 'Cancelado' ? 'border-red-100 opacity-60' : 'border-slate-100'}`}>
                      <div className="relative"><div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-green-500'}`}></div><p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.start || '').split(',')[0]}</p></div>
                      <div className="relative"><div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-orange-500'}`}></div><p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.end || '').split(',')[0]}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- PESTAÑA: BILLETERA --- */}
        {activeTab === 'billetera' && (
            <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
                <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Billetera</h1>
                <p className="text-sm text-slate-500 mb-6">Administra tus métodos de pago para los viajes.</p>

                {currentUser.hasCard ? (
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 shadow-xl text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-5 rounded-full -mr-10 -mt-10"></div>
                        <CreditCard className="w-8 h-8 text-orange-400 mb-6" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Método de Pago Activo</p>
                        <p className="text-xl font-mono tracking-widest">**** **** **** ****</p>
                        <div className="mt-6 flex justify-between items-end">
                            <div><p className="text-[10px] text-slate-400 uppercase font-bold">Titular</p><p className="text-sm font-bold uppercase">{currentUser.name}</p></div>
                            <CheckCircle2 className="w-6 h-6 text-green-400" />
                        </div>
                    </div>
                ) : (
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                        <div className="w-16 h-16 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center mx-auto mb-4"><CreditCard className="w-8 h-8"/></div>
                        <h2 className="text-center font-black text-lg text-slate-800 mb-1">Agrega una Tarjeta</h2>
                        <p className="text-center text-xs text-slate-500 mb-6">Vincula tu tarjeta de débito o crédito para poder solicitar viajes de forma automática.</p>
                        
                        {!clientSecret ? (
                            <button onClick={iniciarVinculacionTarjeta} disabled={iniciandoStripe} className="w-full bg-slate-800 text-white font-black p-4 rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition">
                                {iniciandoStripe ? <Loader2 className="w-5 h-5 animate-spin"/> : <><PlusCircle className="w-5 h-5"/> VINCULAR TARJETA</>}
                            </button>
                        ) : (
                            <Elements stripe={stripePromise} options={{ clientSecret }}>
                                <TarjetaForm clientSecret={clientSecret} customerId={customerId} currentUser={currentUser} onExito={(updatedUser) => setCurrentUser(updatedUser)} />
                            </Elements>
                        )}
                    </div>
                )}
            </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-around items-center pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.05)] rounded-t-3xl z-20">
        <button onClick={() => setActiveTab('pedir')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'pedir' ? 'text-orange-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}><PlusCircle className={`w-6 h-6 ${activeTab === 'pedir' && 'fill-orange-50'}`} /><span className="text-[10px] font-black uppercase tracking-widest">Pedir</span></button>
        <button onClick={() => setActiveTab('historial')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'historial' ? 'text-orange-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}><History className={`w-6 h-6 ${activeTab === 'historial' && 'fill-orange-50'}`} /><span className="text-[10px] font-black uppercase tracking-widest">Viajes</span></button>
        <button onClick={() => setActiveTab('billetera')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'billetera' ? 'text-orange-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}><CreditCard className={`w-6 h-6 ${activeTab === 'billetera' && 'fill-orange-50'}`} /><span className="text-[10px] font-black uppercase tracking-widest">Pagos</span></button>
      </div>
    </div>
  );
}