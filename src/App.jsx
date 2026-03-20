import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Clock, Calendar, Zap, ChevronRight, User, 
  Mail, Lock, Loader2, LogOut, PlusCircle, History, 
  Car, ShieldCheck, CheckCircle, Navigation, Phone, 
  Settings, X, Trash2 // <-- Nuevos íconos agregados
} from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, Autocomplete } from '@react-google-maps/api';

const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const libraries = ['places'];

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pedir');
  const [isEditingProfile, setIsEditingProfile] = useState(false); // Modal de perfil

  // --- Formularios ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  // --- Formulario de Pedido ---
  const [origen, setOrigen] = useState('');
  const [origenCoords, setOrigenCoords] = useState(null); // <-- Guardar Coordenadas Reales
  const [destino, setDestino] = useState('');
  const [destinoCoords, setDestinoCoords] = useState(null); // <-- Guardar Coordenadas Reales
  const [tipoServicio, setTipoServicio] = useState('Prioritario');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');

  // --- Datos ---
  const [misViajes, setMisViajes] = useState([]);

  // --- Google Maps ---
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries });
  const originRef = useRef(null);
  const destRef = useRef(null);

  // Verificar sesión y cargar datos
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
    setEmail(user.email || ''); setPassword(user.password || '');
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

  // --- FUNCIONES DE AUTENTICACIÓN Y PERFIL ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (isRegistering) {
        if (!name || !phone || !email || !password) throw new Error('Llena todos los campos');
        const newUser = { name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(), password, role: 'cliente', status: 'Activo', createdAt: new Date().toISOString() };
        const docRef = await addDoc(collection(db, "clientes"), newUser);
        const userData = { id: docRef.id, ...newUser };
        setCurrentUser(userData); localStorage.setItem('client_session', JSON.stringify(userData));
        escucharMisViajes(userData.name);
      } else {
        const q = query(collection(db, "clientes"), where("email", "==", email.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (snap.empty) throw new Error('Usuario no encontrado');
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
      const updatedData = { name: name.trim(), phone: phone.trim(), password };
      await updateDoc(userRef, updatedData);
      const updatedUser = { ...currentUser, ...updatedData };
      setCurrentUser(updatedUser);
      localStorage.setItem('client_session', JSON.stringify(updatedUser));
      alert("¡Perfil actualizado con éxito!");
      setIsEditingProfile(false);
    } catch (err) { alert("Error al actualizar perfil."); }
    setLoading(false);
  };

  // --- FUNCIONES DE VIAJES ---
  const handlePedirViaje = async (e) => {
    e.preventDefault();
    if (!origen || !destino) return alert("Ingresa origen y destino");
    // VALIDACIÓN IMPORTANTE: Asegurar que se usó el autocompletado para tener coordenadas
    if (!origenCoords || !destinoCoords) {
        return alert("Por favor, selecciona las direcciones sugeridas por Google Maps en la lista desplegable para obtener las coordenadas exactas.");
    }
    if (tipoServicio === 'Programado' && (!fecha || !hora)) return alert("Ingresa fecha y hora para programar");

    setLoading(true);
    try {
      // 1. Calcular la distancia y ruta geométrica antes de guardar (para que el Despacho lo vea)
      const directionsService = new window.google.maps.DirectionsService();
      const results = await directionsService.route({
          origin: origenCoords,
          destination: destinoCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
      });
      
      const routeData = results.routes[0];
      const distance = routeData.legs[0].distance.text;
      const duration = routeData.legs[0].duration.text;
      const geometry = routeData.overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));

      // 2. Crear la ruta con toda la información técnica
      const nuevaRuta = {
        client: currentUser.name || 'Cliente',
        requestUser: currentUser.email || '',
        start: origen,
        startCoords: origenCoords, // <-- Coordenadas para el mapa
        end: destino,
        endCoords: destinoCoords,   // <-- Coordenadas para el mapa
        serviceType: tipoServicio,
        scheduledDate: tipoServicio === 'Programado' ? fecha : new Date().toISOString().split('T')[0],
        scheduledTime: tipoServicio === 'Programado' ? hora : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'Pendiente',
        createdDate: new Date().toISOString(),
        driverId: '',
        driver: '',
        waypoints: [],
        waypointsData: [],
        technicalData: {
            totalDistance: distance,
            totalDuration: duration,
            geometry: geometry // <-- Línea azul de la ruta para el despachador
        }
      };
      
      await addDoc(collection(db, "rutas"), nuevaRuta);
      alert("¡Viaje solicitado con éxito!");
      setOrigen(''); setDestino(''); setOrigenCoords(null); setDestinoCoords(null);
      setActiveTab('historial');
    } catch (err) { 
        console.error(err);
        alert("Error calculando la ruta o solicitando el viaje. Intenta de nuevo."); 
    }
    setLoading(false);
  };

  const handleCancelarViaje = async (viajeId) => {
      if (!confirm("¿Estás seguro de que deseas cancelar esta solicitud de viaje?")) return;
      try {
          await updateDoc(doc(db, "rutas", viajeId), { status: 'Cancelado' });
          alert("El viaje ha sido cancelado.");
      } catch (err) { alert("Error al cancelar el viaje."); }
  };

  // ================= PANTALLA LOGIN / REGISTRO =================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center p-6 font-sans text-slate-800">
        <div className="w-full max-w-sm mx-auto bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30 rotate-3">
              <Car className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-black text-center mb-1">{isRegistering ? 'Crea tu cuenta' : 'Bienvenido'}</h2>
          <p className="text-xs text-center text-slate-500 mb-6">{isRegistering ? 'Solicita unidades al instante' : 'Ingresa para pedir un viaje'}</p>
          
          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && (
              <>
                <div className="relative"><User className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="text" placeholder="Nombre completo" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={name} onChange={e=>setName(e.target.value)} required /></div>
                <div className="relative"><Phone className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="tel" placeholder="WhatsApp / Teléfono" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={phone} onChange={e=>setPhone(e.target.value)} required /></div>
              </>
            )}
            <div className="relative"><Mail className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="email" placeholder="Correo electrónico" disabled={!isRegistering && loading} className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50" value={email} onChange={e=>setEmail(e.target.value)} required /></div>
            <div className="relative"><Lock className="absolute left-3 top-3.5 w-5 h-5 text-slate-400"/><input type="password" placeholder="Contraseña" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
            
            {error && <p className="text-red-500 text-[10px] font-bold text-center">{error}</p>}
            
            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black p-3.5 rounded-xl flex items-center justify-center transition shadow-lg shadow-blue-500/30">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isRegistering ? 'REGISTRARSE' : 'INICIAR SESIÓN')}
            </button>
          </form>
          <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(''); }} className="w-full mt-6 text-[11px] font-bold text-slate-500 hover:text-blue-600 transition">
            {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate aquí'}
          </button>
        </div>
      </div>
    );
  }

  // ================= APLICACIÓN PRINCIPAL =================
  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col relative">
      
      {/* MODAL DE PERFIL (SOBREPUESTO) */}
      {isEditingProfile && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-black text-slate-800">Mi Perfil</h2>
                    <button onClick={() => setIsEditingProfile(false)} className="p-2 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-full transition"><X className="w-5 h-5"/></button>
                </div>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nombre</label><input type="text" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none" value={name} onChange={e=>setName(e.target.value)} required /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">WhatsApp</label><input type="tel" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none" value={phone} onChange={e=>setPhone(e.target.value)} required /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Contraseña</label><input type="text" className="w-full p-3 mt-1 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black p-3.5 rounded-xl flex items-center justify-center transition shadow-lg shadow-blue-500/30 mt-2">
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'GUARDAR CAMBIOS'}
                    </button>
                </form>
            </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-5 rounded-b-3xl shadow-sm border-b border-slate-200 flex justify-between items-center z-10 relative">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setIsEditingProfile(true)}>
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-black text-sm relative overflow-hidden">
            {currentUser?.name ? currentUser.name.substring(0,2).toUpperCase() : 'US'}
            <div className="absolute inset-0 bg-blue-600/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Settings className="w-4 h-4"/></div>
          </div>
          <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">Cliente <Settings className="w-3 h-3"/></p><h2 className="text-sm font-black text-slate-800 leading-tight">{currentUser?.name || 'Usuario'}</h2></div>
        </div>
        <button onClick={() => { localStorage.removeItem('client_session'); setCurrentUser(null); }} className="p-2 bg-slate-50 text-slate-500 hover:text-red-500 rounded-full transition"><LogOut className="w-5 h-5" /></button>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 overflow-y-auto pb-24">
        
        {/* PESTAÑA: PEDIR VIAJE */}
        {activeTab === 'pedir' && (
          <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-4">¿A dónde vamos?</h1>
            
            <form onSubmit={handlePedirViaje} className="space-y-4">
              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 space-y-4">
                {isLoaded ? (
                  <>
                    <div className="relative">
                      <div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-green-500 z-10"></div>
                      <Autocomplete 
                        onLoad={ref => originRef.current = ref} 
                        onPlaceChanged={() => {
                            const place = originRef.current?.getPlace();
                            if (place && place.geometry) {
                                setOrigen(place.formatted_address || place.name);
                                setOrigenCoords({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
                            }
                        }}
                      >
                        <input type="text" placeholder="Punto de Origen (Ej. Reforma 222)" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={origen} onChange={e => setOrigen(e.target.value)} required />
                      </Autocomplete>
                    </div>
                    <div className="w-px h-6 bg-slate-200 ml-5 -my-2"></div>
                    <div className="relative">
                      <div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-red-500 z-10"></div>
                      <Autocomplete 
                        onLoad={ref => destRef.current = ref} 
                        onPlaceChanged={() => {
                            const place = destRef.current?.getPlace();
                            if (place && place.geometry) {
                                setDestino(place.formatted_address || place.name);
                                setDestinoCoords({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
                            }
                        }}
                      >
                        <input type="text" placeholder="Punto de Destino (Ej. Polanco)" className="w-full pl-10 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={destino} onChange={e => setDestino(e.target.value)} required />
                      </Autocomplete>
                    </div>
                  </>
                ) : <div className="p-4 text-center text-xs text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2"/> Cargando mapas...</div>}
              </div>

              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Tipo de Servicio</p>
                <div className="grid grid-cols-2 gap-3">
                  <div onClick={() => setTipoServicio('Prioritario')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${tipoServicio === 'Prioritario' ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                    <Zap className="w-6 h-6" />
                    <span className="text-xs font-bold">Lo antes posible</span>
                  </div>
                  <div onClick={() => setTipoServicio('Programado')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${tipoServicio === 'Programado' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                    <Calendar className="w-6 h-6" />
                    <span className="text-xs font-bold">Programar</span>
                  </div>
                </div>

                {tipoServicio === 'Programado' && (
                  <div className="mt-4 grid grid-cols-2 gap-3 animate-[fadeIn_0.2s_ease-out]">
                    <input type="date" className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none" value={fecha} onChange={e=>setFecha(e.target.value)} required />
                    <input type="time" className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none" value={hora} onChange={e=>setHora(e.target.value)} required />
                  </div>
                )}
              </div>

              <button type="submit" disabled={loading} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black p-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 active:scale-95 transition-all mt-4">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle className="w-5 h-5"/> SOLICITAR VIAJE</>}
              </button>
            </form>
          </div>
        )}

        {/* PESTAÑA: MIS VIAJES (HISTORIAL / ACTIVOS) */}
        {activeTab === 'historial' && (
          <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-4">Mis Viajes</h1>
            
            {misViajes.length === 0 ? (
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 text-center mt-6">
                <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="font-bold text-slate-600">Aún no tienes viajes</p>
                <p className="text-xs text-slate-400 mt-1">Tus solicitudes aparecerán aquí.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {misViajes.map(viaje => (
                  <div key={viaje.id} className={`bg-white p-4 rounded-3xl shadow-sm border-2 overflow-hidden ${viaje.status === 'En Ruta' ? 'border-blue-400 shadow-blue-500/10' : viaje.status === 'Pendiente' ? 'border-orange-200' : viaje.status === 'Cancelado' ? 'border-red-200 bg-red-50/30' : 'border-slate-100'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest mb-1 ${viaje.status === 'En Ruta' ? 'bg-blue-100 text-blue-700' : viaje.status === 'Finalizado' ? 'bg-green-100 text-green-700' : viaje.status === 'Cancelado' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {viaje.status === 'En Ruta' && <Navigation className="w-3 h-3"/>} 
                          {viaje.status === 'Cancelado' && <X className="w-3 h-3"/>}
                          {viaje.status}
                        </span>
                        <p className="text-xs font-bold text-slate-400">{viaje.serviceType === 'Programado' ? `${viaje.scheduledDate} a las ${viaje.scheduledTime}` : 'Servicio Prioritario'}</p>
                      </div>
                    </div>

                    <div className={`relative pl-3 border-l-2 space-y-3 mb-4 ml-1 ${viaje.status === 'Cancelado' ? 'border-red-100 opacity-60' : 'border-slate-100'}`}>
                      <div className="relative">
                        <div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-green-500'}`}></div>
                        <p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.start || '').split(',')[0]}</p>
                      </div>
                      <div className="relative">
                        <div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-red-500'}`}></div>
                        <p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.end || '').split(',')[0]}</p>
                      </div>
                    </div>

                    {/* BOTÓN CANCELAR (Solo si está pendiente) */}
                    {viaje.status === 'Pendiente' && (
                        <button onClick={() => handleCancelarViaje(viaje.id)} className="w-full mb-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-bold p-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors">
                            <Trash2 className="w-4 h-4"/> CANCELAR VIAJE
                        </button>
                    )}

                    {/* Info del Conductor */}
                    {viaje.driver && viaje.status !== 'Cancelado' ? (
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white"><User className="w-5 h-5"/></div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black text-slate-400 uppercase">Conductor Asignado</p>
                          <p className="text-sm font-bold text-slate-800 leading-tight">{viaje.driver}</p>
                        </div>
                      </div>
                    ) : viaje.status === 'Pendiente' ? (
                      <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                        <p className="text-xs font-bold text-orange-700">Buscando conductor cercano...</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* NAVEGACIÓN INFERIOR (TABS) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-around items-center pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.05)] rounded-t-3xl z-20">
        <button onClick={() => setActiveTab('pedir')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'pedir' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
          <PlusCircle className={`w-6 h-6 ${activeTab === 'pedir' && 'fill-blue-50'}`} />
          <span className="text-[10px] font-black uppercase tracking-widest">Pedir</span>
        </button>
        <button onClick={() => setActiveTab('historial')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'historial' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
          <History className={`w-6 h-6 ${activeTab === 'historial' && 'fill-blue-50'}`} />
          <span className="text-[10px] font-black uppercase tracking-widest">Viajes</span>
        </button>
      </div>
    </div>
  );
}
