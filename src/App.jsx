import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Clock, Calendar, Zap, ChevronRight, User, 
  Mail, Lock, Loader2, LogOut, PlusCircle, History, 
  Car, ShieldCheck, CheckCircle, Navigation, Phone, 
  Settings, X, Trash2, BellRing, Briefcase, MessageSquare, Send, CreditCard, CheckCircle2, FileText, Download, Share2, LocateFixed
} from 'lucide-react';
import { db, setupPushNotifications } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Autocomplete, Marker, Polyline } from '@react-google-maps/api';

// --- STRIPE ---
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { jsPDF } from 'jspdf';

const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const GOOGLE_VECTOR_MAP_ID = "73f56298887c80075f6fc648";
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

class TripLogixClientErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
            message: ''
        };
    }

    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            message: error?.message || 'Se produjo un error inesperado.'
        };
    }

    componentDidCatch(error, errorInfo) {
        console.error('TripLogix Client render error:', error, errorInfo);

        try {
            localStorage.setItem(
                'triplogix_last_client_error',
                JSON.stringify({
                    message: error?.message || String(error),
                    stack: error?.stack || '',
                    componentStack: errorInfo?.componentStack || '',
                    createdAt: new Date().toISOString()
                })
            );
        } catch (_) {}
    }

    recoverApp = () => {
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
                <div className="w-full max-w-sm bg-white text-slate-800 rounded-[2rem] p-6 shadow-2xl border-4 border-orange-500">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center mb-4">
                        <ShieldCheck className="w-8 h-8" />
                    </div>

                    <h1 className="text-xl font-black text-center">
                        TripLogix se protegió de un error
                    </h1>

                    <p className="text-sm text-slate-500 text-center mt-2">
                        La aplicación evitó quedarse completamente en blanco.
                    </p>

                    <div className="mt-4 p-3 rounded-xl bg-slate-100 border border-slate-200">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Detalle técnico
                        </p>
                        <p className="text-xs text-slate-700 mt-1 break-words">
                            {this.state.message}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={this.recoverApp}
                        className="w-full mt-5 py-4 rounded-2xl bg-orange-500 text-white font-black uppercase tracking-widest text-xs"
                    >
                        Recargar aplicación
                    </button>
                </div>
            </div>
        );
    }
}


// =========================================================================
// TRIPLOGIX: TARIFA Y COMPROBANTE OFICIAL DE VIAJE (NO FISCAL)
// La estructura se inspira en plataformas de movilidad: tarifa base + distancia
// + tiempo + cuota operativa + ajustes autorizados. Las tarifas son propias de
// TripLogix y se concentran aquí para poder cambiarlas sin tocar el resto de la app.
// =========================================================================
const TRIPLOGIX_RECEIPT_CONFIG = Object.freeze({
    brandName: 'TripLogix',
    slogan: 'Movilidad inteligente, segura y regulada',
    currency: 'MXN',
    baseFare: 35,
    perKm: 15,
    perMinute: 1.5,
    serviceFee: 12,
    minimumFare: 75,
    defaultDemandMultiplier: 1
});

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getTimestampMs = (value) => {
    if (!value) return null;
    try {
        if (typeof value?.toDate === 'function') return value.toDate().getTime();
        if (value instanceof Date) return value.getTime();
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
};

const getTripDistanceKmForReceipt = (route) => {
    const candidates = [
        route?.receipt?.distanceKm,
        route?.realDistanceDriven,
        route?.actualDistanceKm,
        route?.finalDistanceKm,
        route?.pricing?.distanceKm,
        route?.liveNavigation?.distanceKm,
        route?.technicalData?.actualDistance,
        route?.technicalData?.totalDistance
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return roundMoney(value);
    }

    return 0;
};

const getTripDurationMinutesForReceipt = (route, forcedEndTimestamp = null) => {
    const startMs = getTimestampMs(
        route?.actualStartTimestamp ||
        route?.navigationStartedAt ||
        route?.startedAt
    );

    const endMs = getTimestampMs(
        forcedEndTimestamp ||
        route?.actualEndTimestamp ||
        route?.finishedAt ||
        route?.receipt?.actualEndTimestamp
    );

    if (startMs && endMs && endMs > startMs) {
        return Math.max(1, Math.round((endMs - startMs) / 60000));
    }

    const candidates = [
        route?.receipt?.durationMinutes,
        route?.actualDurationMinutes,
        route?.finalDurationMinutes,
        route?.pricing?.durationMinutes,
        route?.technicalData?.actualDuration,
        route?.technicalData?.totalDuration
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.max(1, Math.round(value));
    }

    return 0;
};

const calculateTripLogixFare = (route, overrides = {}) => {
    const distanceKm = Number.isFinite(Number(overrides.distanceKm))
        ? Number(overrides.distanceKm)
        : getTripDistanceKmForReceipt(route);

    const durationMinutes = Number.isFinite(Number(overrides.durationMinutes))
        ? Number(overrides.durationMinutes)
        : getTripDurationMinutesForReceipt(route, overrides.actualEndTimestamp);

    const configuredPricing = route?.pricing || {};
    const baseFare = Number(configuredPricing.baseFare ?? TRIPLOGIX_RECEIPT_CONFIG.baseFare);
    const perKm = Number(configuredPricing.perKm ?? TRIPLOGIX_RECEIPT_CONFIG.perKm);
    const perMinute = Number(configuredPricing.perMinute ?? TRIPLOGIX_RECEIPT_CONFIG.perMinute);
    const serviceFee = Number(configuredPricing.serviceFee ?? TRIPLOGIX_RECEIPT_CONFIG.serviceFee);
    const minimumFare = Number(configuredPricing.minimumFare ?? TRIPLOGIX_RECEIPT_CONFIG.minimumFare);
    const tolls = Math.max(0, Number(route?.tolls ?? configuredPricing.tolls ?? 0) || 0);

    const demandMultiplierRaw = Number(
        route?.demandMultiplier ??
        route?.surgeMultiplier ??
        configuredPricing.demandMultiplier ??
        TRIPLOGIX_RECEIPT_CONFIG.defaultDemandMultiplier
    );
    const demandMultiplier = Math.min(3, Math.max(1, Number.isFinite(demandMultiplierRaw) ? demandMultiplierRaw : 1));

    const baseAmount = roundMoney(baseFare);
    const distanceAmount = roundMoney(distanceKm * perKm);
    const timeAmount = roundMoney(durationMinutes * perMinute);
    const standardVariableFare = roundMoney(baseAmount + distanceAmount + timeAmount);
    const adjustedVariableFare = roundMoney(standardVariableFare * demandMultiplier);
    const demandAdjustment = roundMoney(adjustedVariableFare - standardVariableFare);
    const minimumFareApplied = adjustedVariableFare < minimumFare;
    const mobilityFare = roundMoney(Math.max(minimumFare, adjustedVariableFare));
    const subtotal = roundMoney(mobilityFare + serviceFee + tolls);

    // Este comprobante no es CFDI, por lo que no se desglosan impuestos fiscales.
    const taxes = 0;
    const total = roundMoney(subtotal + taxes);

    return {
        currency: TRIPLOGIX_RECEIPT_CONFIG.currency,
        distanceKm: roundMoney(distanceKm),
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        baseFare: roundMoney(baseFare),
        perKm: roundMoney(perKm),
        perMinute: roundMoney(perMinute),
        distanceAmount,
        timeAmount,
        demandMultiplier,
        demandAdjustment,
        minimumFare,
        minimumFareApplied,
        mobilityFare,
        serviceFee: roundMoney(serviceFee),
        tolls: roundMoney(tolls),
        subtotal,
        taxes,
        total
    };
};

const makeTripLogixFolio = (route, issuedAt) => {
    if (route?.receipt?.folio) return String(route.receipt.folio);
    const datePart = new Date(issuedAt).toISOString().slice(0, 10).replace(/-/g, '');
    const idPart = String(route?.id || route?.tripId || 'VIAJE')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8)
        .toUpperCase()
        .padStart(8, '0');
    return `TLX-${datePart}-${idPart}`;
};

const buildTripLogixReceipt = (route, overrides = {}) => {
    const existingReceipt = route?.receipt && typeof route.receipt === 'object'
        ? route.receipt
        : null;

    const issuedAt = overrides.issuedAt || existingReceipt?.issuedAt || new Date().toISOString();
    const actualEndTimestamp = overrides.actualEndTimestamp || route?.actualEndTimestamp || existingReceipt?.actualEndTimestamp || issuedAt;
    const calculatedPricing = calculateTripLogixFare(route, {
        ...overrides,
        actualEndTimestamp
    });

    const pricing = existingReceipt?.pricing && Number.isFinite(Number(existingReceipt.pricing.total))
        ? { ...calculatedPricing, ...existingReceipt.pricing }
        : calculatedPricing;

    const distanceKm = Number.isFinite(Number(existingReceipt?.distanceKm))
        ? Number(existingReceipt.distanceKm)
        : Number(pricing.distanceKm || 0);

    const durationMinutes = Number.isFinite(Number(existingReceipt?.durationMinutes))
        ? Number(existingReceipt.durationMinutes)
        : Number(pricing.durationMinutes || 0);

    return {
        version: Number(existingReceipt?.version || 1),
        documentType: String(existingReceipt?.documentType || 'Comprobante oficial de viaje'),
        fiscalType: String(existingReceipt?.fiscalType || 'NO_FISCAL'),
        folio: String(existingReceipt?.folio || makeTripLogixFolio(route, issuedAt)),
        issuedAt: String(issuedAt),
        issuer: {
            tradeName: String(existingReceipt?.issuer?.tradeName || TRIPLOGIX_RECEIPT_CONFIG.brandName),
            slogan: String(existingReceipt?.issuer?.slogan || TRIPLOGIX_RECEIPT_CONFIG.slogan)
        },
        tripId: String(existingReceipt?.tripId || route?.id || route?.tripId || ''),
        clientName: String(existingReceipt?.clientName || route?.client || route?.clientName || 'Cliente'),
        clientPhone: String(existingReceipt?.clientPhone || route?.clientPhone || route?.requestUser || ''),
        driverName: String(existingReceipt?.driverName || route?.driver || route?.driverName || 'Conductor no registrado'),
        driverId: String(existingReceipt?.driverId || route?.driverId || ''),
        vehicle: String(existingReceipt?.vehicle || route?.vehicle || route?.driverVehicle || route?.vehicleModel || 'Unidad no registrada'),
        vehiclePlate: String(existingReceipt?.vehiclePlate || route?.vehiclePlate || route?.driverVehiclePlate || ''),
        origin: String(existingReceipt?.origin || route?.start || route?.origin || 'Origen no registrado'),
        destination: String(existingReceipt?.destination || route?.end || route?.destination || 'Destino no registrado'),
        serviceType: String(existingReceipt?.serviceType || route?.serviceType || 'Servicio TripLogix'),
        scheduledDate: String(existingReceipt?.scheduledDate || route?.scheduledDate || route?.pickupDate || route?.finalDate || ''),
        scheduledTime: String(existingReceipt?.scheduledTime || route?.scheduledTime || route?.pickupTime || ''),
        actualStartTime: String(existingReceipt?.actualStartTime || route?.actualStartTime || route?.startTime || ''),
        actualStartTimestamp: String(existingReceipt?.actualStartTimestamp || route?.actualStartTimestamp || route?.navigationStartedAt || ''),
        actualEndTime: String(overrides.actualEndTime || existingReceipt?.actualEndTime || route?.actualEndTime || route?.endTime || ''),
        actualEndTimestamp: String(actualEndTimestamp || ''),
        distanceKm: roundMoney(distanceKm),
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        pricing,
        paymentMethod: String(existingReceipt?.paymentMethod || route?.paymentMethod || 'No registrado'),
        paymentStatus: String(existingReceipt?.paymentStatus || route?.paymentStatus || 'Pendiente de conciliación'),
        notes: String(existingReceipt?.notes || 'Comprobante operativo no fiscal. No sustituye una factura CFDI.')
    };
};

const formatTripLogixMoney = (value, currency = 'MXN') => {
    try {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2
        }).format(Number(value) || 0);
    } catch (e) {
        return `$${(Number(value) || 0).toFixed(2)} ${currency}`;
    }
};

const formatTripLogixDateTime = (value) => {
    const ms = getTimestampMs(value);
    if (!ms) return 'No registrado';
    return new Date(ms).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short'
    });
};

const createTripLogixReceiptPdf = (route) => {
    const receipt = buildTripLogixReceipt(route);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    let y = 16;

    const ensureSpace = (needed = 16) => {
        if (y + needed > 286) {
            pdf.addPage();
            y = 18;
        }
    };

    const addLine = (label, value, options = {}) => {
        ensureSpace(options.height || 9);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(options.labelSize || 7.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(String(label).toUpperCase(), margin, y);
        y += 3.2;

        pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
        pdf.setFontSize(options.valueSize || 9.2);
        pdf.setTextColor(15, 23, 42);
        const lines = pdf.splitTextToSize(String(value || 'No registrado'), contentWidth);
        pdf.text(lines, margin, y);
        y += lines.length * 4.2 + 2.6;
    };

    const addSectionTitle = (title) => {
        ensureSpace(11);
        y += 1;
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(margin, y - 4.5, contentWidth, 8.5, 2, 2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(249, 115, 22);
        pdf.text(String(title).toUpperCase(), margin + 4, y + 1);
        y += 8.5;
    };

    // Encabezado oficial TripLogix.
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(margin, y, contentWidth, 33, 4, 4, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(255, 255, 255);
    pdf.text('Trip', margin + 8, y + 13);
    pdf.setTextColor(249, 115, 22);
    pdf.text('Logix', margin + 24.5, y + 13);
    pdf.setFontSize(9);
    pdf.setTextColor(226, 232, 240);
    pdf.text(TRIPLOGIX_RECEIPT_CONFIG.slogan, margin + 8, y + 21);
    pdf.setFontSize(8);
    pdf.text('COMPROBANTE OFICIAL DE VIAJE - NO FISCAL', margin + 8, y + 28);
    y += 38;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Folio: ${receipt.folio}`, margin, y);
    y += 7;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Emitido: ${formatTripLogixDateTime(receipt.issuedAt)}`, margin, y);
    y += 7;
    pdf.text(`ID de viaje: ${receipt.tripId || 'No registrado'}`, margin, y);
    y += 6;

    addSectionTitle('Pasajero y conductor');
    addLine('Pasajero', receipt.clientName);
    if (receipt.clientPhone) addLine('Contacto del pasajero', receipt.clientPhone);
    addLine('Conductor', receipt.driverName);
    addLine('Unidad', `${receipt.vehicle}${receipt.vehiclePlate ? ` - Placas ${receipt.vehiclePlate}` : ''}`);

    addSectionTitle('Ruta del servicio');
    addLine('Origen', receipt.origin);
    addLine('Destino', receipt.destination);
    addLine('Tipo de servicio', receipt.serviceType);
    addLine('Inicio real', receipt.actualStartTime || formatTripLogixDateTime(receipt.actualStartTimestamp));
    addLine('Finalización', receipt.actualEndTime || formatTripLogixDateTime(receipt.actualEndTimestamp));
    addLine('Distancia considerada', `${receipt.distanceKm.toFixed(2)} km`);
    addLine('Duración considerada', `${receipt.durationMinutes} min`);

    addSectionTitle('Desglose del importe');
    const pricingRows = [
        ['Tarifa base', receipt.pricing.baseFare],
        [`Distancia (${receipt.distanceKm.toFixed(2)} km x ${formatTripLogixMoney(receipt.pricing.perKm)})`, receipt.pricing.distanceAmount],
        [`Tiempo (${receipt.durationMinutes} min x ${formatTripLogixMoney(receipt.pricing.perMinute)})`, receipt.pricing.timeAmount]
    ];

    if (receipt.pricing.demandMultiplier > 1) {
        pricingRows.push([`Ajuste de demanda x${receipt.pricing.demandMultiplier.toFixed(2)}`, receipt.pricing.demandAdjustment]);
    }
    if (receipt.pricing.minimumFareApplied) {
        pricingRows.push(['Ajuste a tarifa mínima', Math.max(0, receipt.pricing.minimumFare - (receipt.pricing.baseFare + receipt.pricing.distanceAmount + receipt.pricing.timeAmount + receipt.pricing.demandAdjustment))]);
    }
    pricingRows.push(['Cuota operativa y de seguridad', receipt.pricing.serviceFee]);
    if (receipt.pricing.tolls > 0) pricingRows.push(['Peajes registrados', receipt.pricing.tolls]);

    pricingRows.forEach(([label, value]) => {
        ensureSpace(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105);
        pdf.text(String(label), margin, y);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatTripLogixMoney(value, receipt.pricing.currency), pageWidth - margin, y, { align: 'right' });
        y += 7;
    });

    ensureSpace(22);
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 8;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(249, 115, 22);
    pdf.text('TOTAL', margin, y);
    pdf.text(formatTripLogixMoney(receipt.pricing.total, receipt.pricing.currency), pageWidth - margin, y, { align: 'right' });
    y += 10;

    addLine('Método de pago', receipt.paymentMethod);
    addLine('Estado del pago', receipt.paymentStatus);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(124, 45, 18);
    pdf.text(receipt.notes, pageWidth / 2, 284, { align: 'center' });

    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`TripLogix - ${receipt.folio} - Página ${page} de ${pages}`, pageWidth / 2, 291, { align: 'center' });
    }

    return { pdf, receipt };
};

const writeTripLogixPdfToNativeCache = async (pdf, filename) => {
    const dataUri = String(pdf.output('datauristring') || '');
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : '';

    if (!base64Data) {
        throw new Error('No fue posible convertir el recibo PDF.');
    }

    await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true
    });

    const uriResult = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache
    });

    return uriResult.uri;
};

const downloadTripLogixReceiptPdf = async (route) => {
    try {
        const { pdf, receipt } = createTripLogixReceiptPdf(route);
        const filename = `TripLogix_Recibo_${receipt.folio}.pdf`;

        if (Capacitor.isNativePlatform()) {
            const fileUri = await writeTripLogixPdfToNativeCache(pdf, filename);

            await Share.share({
                title: `Recibo TripLogix ${receipt.folio}`,
                text: 'Abre, guarda o envía tu comprobante oficial de viaje.',
                files: [fileUri],
                dialogTitle: 'Guardar recibo PDF'
            });
            return;
        }

        pdf.save(filename);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('No se pudo generar el recibo PDF:', error);
        alert('No se pudo generar el recibo PDF. Vuelve a intentarlo.');
    }
};

const shareTripLogixReceiptPdf = async (route) => {
    try {
        const { pdf, receipt } = createTripLogixReceiptPdf(route);
        const filename = `TripLogix_Recibo_${receipt.folio}.pdf`;

        if (Capacitor.isNativePlatform()) {
            const fileUri = await writeTripLogixPdfToNativeCache(pdf, filename);

            await Share.share({
                title: `Recibo TripLogix ${receipt.folio}`,
                text: `Comprobante oficial de viaje TripLogix ${receipt.folio}`,
                files: [fileUri],
                dialogTitle: 'Compartir recibo'
            });
            return;
        }

        const blob = pdf.output('blob');

        try {
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Recibo TripLogix ${receipt.folio}`,
                    text: `Comprobante oficial de viaje TripLogix ${receipt.folio}`,
                    files: [file]
                });
                return;
            }
        } catch (webShareError) {
            if (webShareError?.name === 'AbortError') return;
            console.warn('No se pudo compartir directamente el PDF:', webShareError);
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('No se pudo compartir el recibo PDF:', error);
        alert('No se pudo compartir el recibo PDF. Vuelve a intentarlo.');
    }
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
// HELPERS: MAPA EN VIVO DEL CLIENTE
// =========================================================================
const MAP_CENTER_MX = { lat: 19.4326, lng: -99.1332 };

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const normalizePoint = (point) => {
    if (!point) return null;

    const lat = toFiniteNumber(point.lat);
    const lng = toFiniteNumber(point.lng ?? point.lon);

    if (lat === null || lng === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    return { ...point, lat, lng };
};

const normalizePath = (path) => {
    if (!Array.isArray(path)) return [];
    return path.map(normalizePoint).filter(Boolean);
};

const getDistanceMeters = (p1, p2) => {
    const a = normalizePoint(p1);
    const b = normalizePoint(p2);
    if (!a || !b) return Infinity;

    const R = 6371e3;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;

    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const getSafeMetric = (value, fallback = '--') => {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return value;
};


const normalizeHeadingDegrees = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return ((number % 360) + 360) % 360;
};

const getHeadingDifference = (from, to) => {
    const a = normalizeHeadingDegrees(from);
    const b = normalizeHeadingDegrees(to);
    return Math.abs(((b - a + 540) % 360) - 180);
};

const isDispatcherScheduledTrip = (route) => {
    if (!route) return false;

    return Boolean(
        route?.pricingVisibility === 'hidden_during_trip' ||
        route?.showPricingDuringTrip === false ||
        route?.tripSource === 'dispatcher' ||
        route?.createdBy === 'dispatcher' ||
        route?.pricingPolicy === 'dispatcher_hidden_during_trip' ||
        route?.officialScheduledTime ||
        route?.technicalData?.carpool
    );
};

const shouldHideTripPricingDuringActive = (route) => {
    return isDispatcherScheduledTrip(route) && route?.status !== 'Finalizado';
};

const getDriverPublishedPricing = (route) => {
    if (shouldHideTripPricingDuringActive(route)) {
        return {
            available: false,
            hidden: true,
            currency: 'MXN',
            total: null,
            source: 'Tarifa administrada por despacho',
            updatedAt: ''
        };
    }

    const pricing = route?.pricing && typeof route.pricing === 'object'
        ? route.pricing
        : null;

    const total = Number(pricing?.total);
    const isDriverPricing = String(pricing?.source || '').startsWith('driver-');

    if (!pricing || !Number.isFinite(total) || total < 0) {
        return {
            available: false,
            currency: 'MXN',
            total: null,
            source: 'Pendiente de cálculo del conductor',
            updatedAt: ''
        };
    }

    return {
        ...pricing,
        available: true,
        total,
        currency: pricing.currency || 'MXN',
        source: isDriverPricing
            ? 'Tarifa calculada por el conductor'
            : 'Tarifa registrada',
        updatedAt: pricing.updatedAt || pricing.estimatedAt || ''
    };
};


const normalizeFrequentLocation = (location, index = 0) => {
    if (!location || typeof location === 'string') return null;

    const point = normalizePoint(location.coords || location);
    const address = String(
        location.address ||
        location.formattedAddress ||
        location.formatted_address ||
        location.description ||
        ''
    ).trim();

    if (!point || !address) return null;

    const fallbackLabel = address.split(',')[0]?.trim() || `Dirección ${index + 1}`;

    return {
        label: String(location.label || location.name || fallbackLabel).trim(),
        address,
        lat: point.lat,
        lng: point.lng,
        updatedAt: location.updatedAt || location.savedAt || new Date().toISOString()
    };
};

const getFrequentLocationKey = (location) => {
    const normalized = normalizeFrequentLocation(location);
    if (!normalized) return '';
    return `${normalized.lat.toFixed(5)}|${normalized.lng.toFixed(5)}|${normalized.address.toLowerCase()}`;
};

const mergeFrequentLocations = (existingLocations, newLocations, limit = 8) => {
    const merged = [];
    const seen = new Set();

    [...(newLocations || []), ...(existingLocations || [])].forEach((location, index) => {
        const normalized = normalizeFrequentLocation(location, index);
        if (!normalized) return;

        const key = getFrequentLocationKey(normalized);
        if (!key || seen.has(key)) return;

        seen.add(key);
        merged.push(normalized);
    });

    return merged.slice(0, limit);
};

const getTripDriverLabel = (trip) => {
    if (trip?.driver) return trip.driver;
    if (trip?.ofertaEstado === 'Pendiente' && trip?.ofertaParaNombre) {
        return `${trip.ofertaParaNombre} · Confirmando`;
    }
    if (trip?.assignmentStatus === 'Sin conductores disponibles') {
        return 'Buscando conductor disponible';
    }
    return 'Asignando...';
};


const getOptionalNumber = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

const getDriverDetailsFromTrip = (trip) => ({
    id: trip?.driverId || '',
    name: trip?.driver || trip?.driverName || 'Conductor asignado',
    phone: trip?.driverPhone || '',
    vehicle: trip?.vehicle || trip?.driverVehicle || '',
    vehicleModel: trip?.vehicleModel || '',
    vehicleType: trip?.vehicleType || '',
    vehiclePlate: trip?.vehiclePlate || trip?.driverVehiclePlate || '',
    rating: getOptionalNumber(trip?.driverRating, trip?.rating),
    fotoPerfil: trip?.driverPhoto || trip?.fotoPerfil || '',
    status: trip?.driverStatus || ''
});

const mergeDriverDetails = (trip, driverData = {}) => {
    const fallback = getDriverDetailsFromTrip(trip);

    return {
        ...fallback,
        ...driverData,
        id: driverData?.id || fallback.id,
        name: driverData?.name || fallback.name,
        phone: driverData?.phone || fallback.phone,
        vehicle: driverData?.vehicle || fallback.vehicle,
        vehicleModel: driverData?.vehicleModel || fallback.vehicleModel,
        vehicleType: driverData?.vehicleType || fallback.vehicleType,
        vehiclePlate: driverData?.vehiclePlate || fallback.vehiclePlate,
        rating: getOptionalNumber(driverData?.rating, fallback.rating),
        fotoPerfil: driverData?.fotoPerfil || fallback.fotoPerfil,
        status: driverData?.status || fallback.status
    };
};

const ARRIVAL_ORDINALS = [
    'primer',
    'segundo',
    'tercer',
    'cuarto',
    'quinto',
    'sexto',
    'séptimo',
    'octavo',
    'noveno',
    'décimo'
];

const getArrivalStageInfo = (trip) => {
    const waypointData = Array.isArray(trip?.waypointsData) ? trip.waypointsData : [];
    const waypointCount = waypointData.length;

    const rawIndexCandidates = [
        trip?.proximityAlert?.stopIndex,
        trip?.liveNavigation?.stopIndex,
        trip?.currentStopIndex,
        trip?.nextStopIdx,
        0
    ];

    const validStopIndexes = rawIndexCandidates
        .map(candidate => Number(candidate))
        .filter(candidate => Number.isFinite(candidate) && candidate >= 0)
        .map(candidate => Math.trunc(candidate));

    // Se usa el punto más avanzado para impedir que una alerta antigua del
    // primer pasajero mantenga la pantalla congelada cuando el conductor ya avanzó.
    const stopIndex = validStopIndexes.length ? Math.max(...validStopIndexes) : 0;

    const alertPassenger = String(trip?.proximityAlert?.passenger || '').trim();

    if (stopIndex <= 0) {
        const target = alertPassenger || trip?.startCoords?.passengerName || trip?.startCoords?.contact || trip?.start || '';
        return {
            stopIndex: 0,
            cardLabel: 'LLEGANDO AL PUNTO DE ORIGEN',
            modalLabel: 'al punto de origen',
            target
        };
    }

    if (stopIndex <= waypointCount) {
        const waypoint = waypointData[stopIndex - 1] || {};
        const ordinal = ARRIVAL_ORDINALS[stopIndex - 1] || `punto intermedio ${stopIndex}`;
        const target = alertPassenger || waypoint?.passengerName || waypoint?.contact || waypoint?.address || trip?.waypoints?.[stopIndex - 1] || '';

        return {
            stopIndex,
            cardLabel: ARRIVAL_ORDINALS[stopIndex - 1]
                ? `LLEGANDO AL ${ordinal.toUpperCase()} PUNTO INTERMEDIO`
                : `LLEGANDO AL PUNTO INTERMEDIO ${stopIndex}`,
            modalLabel: ARRIVAL_ORDINALS[stopIndex - 1]
                ? `al ${ordinal} punto intermedio`
                : `al punto intermedio ${stopIndex}`,
            target
        };
    }

    const target = alertPassenger || trip?.endCoords?.passengerName || trip?.endCoords?.contact || trip?.end || '';
    return {
        stopIndex,
        cardLabel: 'LLEGANDO AL DESTINO FINAL',
        modalLabel: 'al destino final',
        target
    };
};


const getArrivalAcknowledgementText = (trip) => {
    const stage = getArrivalStageInfo(trip);
    const waypointCount = Array.isArray(trip?.waypointsData)
        ? trip.waypointsData.length
        : 0;

    if (stage.stopIndex <= 0) {
        return 'ENTENDIDO, YA VOY SALIENDO';
    }

    if (stage.stopIndex <= waypointCount) {
        return 'ENTENDIDO, ESTOY LISTO';
    }

    return 'ENTENDIDO, GRACIAS';
};

const getProximityAlertKey = (trip) => {
    const rawStopIndex = trip?.proximityAlert?.stopIndex;
    const parsedStopIndex = (rawStopIndex === null || rawStopIndex === undefined || rawStopIndex === '')
        ? getArrivalStageInfo(trip).stopIndex
        : Number(rawStopIndex);

    const safeStopIndex = Number.isFinite(parsedStopIndex)
        ? Math.max(0, Math.trunc(parsedStopIndex))
        : 0;

    return `${trip?.id || 'trip'}:${safeStopIndex}`;
};

const getDriverCarIcon = () => {
    if (!window.google?.maps) return undefined;

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="21" fill="#f97316" stroke="white" stroke-width="4"/>
          <path d="M14 25.5V21c0-.9.4-1.8 1.1-2.4l2.2-5c.4-.9 1.3-1.6 2.3-1.6h6.8c1 0 1.9.6 2.3 1.6l2.2 5c.7.6 1.1 1.5 1.1 2.4v4.5c0 .8-.7 1.5-1.5 1.5H29v2c0 .6-.4 1-1 1h-1.2c-.6 0-1-.4-1-1v-2h-5.6v2c0 .6-.4 1-1 1H18c-.6 0-1-.4-1-1v-2h-1.5c-.8 0-1.5-.7-1.5-1.5Z" fill="white"/>
          <path d="M18.8 15h8.4l1.7 3.8H17.1L18.8 15Z" fill="#fdba74"/>
          <circle cx="18.4" cy="23.2" r="1.7" fill="#0f172a"/>
          <circle cx="27.6" cy="23.2" r="1.7" fill="#0f172a"/>
        </svg>
    `;

    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new window.google.maps.Size(46, 46),
        anchor: new window.google.maps.Point(23, 23)
    };
};

const getRemainingWaypointsForClient = (viaje) => {
    const waypoints = Array.isArray(viaje?.waypointsData) ? viaje.waypointsData : [];

    // Se toma el índice más avanzado disponible. Esto evita volver a incluir
    // paradas que el conductor ya confirmó y reduce diferencias de km/ETA.
    const evidenceIndexes = [
        ...(Array.isArray(viaje?.evidenciasLlegada) ? viaje.evidenciasLlegada : []),
        ...(Array.isArray(viaje?.evidencias) ? viaje.evidencias : [])
    ]
        .map(item => Number(item?.stopIndex))
        .filter(Number.isFinite)
        .map(index => index + 1);

    const candidates = [
        Number(viaje?.currentStopIndex),
        Number(viaje?.nextStopIdx),
        Number(viaje?.proximityAlert?.stopIndex),
        ...evidenceIndexes,
        0
    ].filter(Number.isFinite);

    const stopIndex = Math.max(0, ...candidates);

    return waypoints
        .filter((_, idx) => (idx + 1) >= stopIndex)
        .map(normalizePoint)
        .filter(Boolean)
        .slice(0, 23);
};

// =========================================================================
// MÉTRICAS OFICIALES EN VIVO
// La app cliente NO vuelve a calcular el ETA durante el viaje. Lee exactamente
// liveNavigation, que es publicado por la app del conductor.
// =========================================================================
const firstFiniteNumber = (...values) => {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
};

const getAuthoritativeLiveMetrics = (viaje) => {
    const live = viaje?.liveNavigation || {};

    const liveDistanceKm = firstFiniteNumber(
        live.distanceKm,
        live.totalDistanceKm,
        Number.isFinite(Number(live.distanceMeters)) ? Number(live.distanceMeters) / 1000 : null,
        Number.isFinite(Number(live.totalDistanceMeters)) ? Number(live.totalDistanceMeters) / 1000 : null
    );

    const liveDurationMinutes = firstFiniteNumber(
        live.durationMinutes,
        live.totalDurationMinutes,
        Number.isFinite(Number(live.durationSeconds)) ? Number(live.durationSeconds) / 60 : null,
        Number.isFinite(Number(live.totalDurationSeconds)) ? Number(live.totalDurationSeconds) / 60 : null
    );

    const fallbackDistance = firstFiniteNumber(
        viaje?.technicalData?.totalDistance,
        viaje?.distanceKm
    );

    const fallbackDuration = firstFiniteNumber(
        viaje?.technicalData?.totalDuration,
        viaje?.durationMinutes
    );

    const nextStopDistanceKm = firstFiniteNumber(
        live.nextStopDistanceKm,
        Number.isFinite(Number(live.nextStopDistanceMeters))
            ? Number(live.nextStopDistanceMeters) / 1000
            : null
    );

    const nextStopDurationMinutes = firstFiniteNumber(
        live.nextStopDurationMinutes,
        Number.isFinite(Number(live.nextStopDurationSeconds))
            ? Number(live.nextStopDurationSeconds) / 60
            : null
    );

    const hasLiveNumbers = liveDistanceKm !== null || liveDurationMinutes !== null;
    const source = String(live.source || '');
    const isDriverSource = source.startsWith('driver-');
    const distance = liveDistanceKm ?? fallbackDistance;
    const duration = liveDurationMinutes ?? fallbackDuration;

    return {
        totalDistance: distance === null ? '--' : distance.toFixed(1),
        totalDuration: duration === null ? '--' : Math.max(0, Math.round(duration)),
        nextStopDistance: nextStopDistanceKm === null ? '' : nextStopDistanceKm.toFixed(1),
        nextStopDuration: nextStopDurationMinutes === null ? '' : Math.max(0, Math.round(nextStopDurationMinutes)),
        stopIndex: firstFiniteNumber(live.stopIndex, live.currentStopIndex) ?? 0,
        heading: normalizeHeadingDegrees(
            live.heading ??
            viaje?.liveHeading ??
            0
        ),
        isLive: hasLiveNumbers && isDriverSource && Boolean(viaje?.currentLocation),
        source: hasLiveNumbers ? (source || 'ruta-planificada') : 'ruta-planificada',
        updatedAt: live.updatedAt || viaje?.liveRouteUpdatedAt || viaje?.lastUpdate || ''
    };
};

const trimPathFromPoint = (path, point) => {
    const validPath = normalizePath(path);
    const validPoint = normalizePoint(point);

    if (!validPoint || validPath.length < 3) return validPath;

    let closestIndex = 0;
    let closestDistance = Infinity;

    validPath.forEach((candidate, index) => {
        const distance = getDistanceMeters(validPoint, candidate);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    });

    return validPath.slice(Math.max(0, closestIndex - 1));
};

const getTrackingPath = (viaje) => {
    const liveRoute = normalizePath(viaje?.liveRouteGeometry);
    if (liveRoute.length > 1) return liveRoute;

    const liveEmbeddedRoute = normalizePath(viaje?.liveNavigation?.geometry);
    if (liveEmbeddedRoute.length > 1) return liveEmbeddedRoute;

    const plannedRoute = normalizePath(viaje?.technicalData?.geometry);
    if (plannedRoute.length > 1) {
        return trimPathFromPoint(plannedRoute, viaje?.currentLocation);
    }

    return [];
};

// =========================================================================
// COMPONENTE: MAPA EN VIVO SIN RECÁLCULO DUPLICADO
// =========================================================================
const LiveTrackingMap = ({
    viaje,
    expanded = false,
    followDriver = true,
    onMetricsChange,
    onDriverInfoClick = null
}) => {
    const mapRef = useRef(null);

    const driverPoint = normalizePoint(viaje?.currentLocation);
    const startPoint = normalizePoint(viaje?.startCoords);
    const endPoint = normalizePoint(viaje?.endCoords);
    const waypointPoints = (Array.isArray(viaje?.waypointsData) ? viaje.waypointsData : [])
        .map(normalizePoint)
        .filter(Boolean);
    const visiblePath = getTrackingPath(viaje);
    const center = driverPoint || startPoint || visiblePath[0] || MAP_CENTER_MX;
    const metrics = getAuthoritativeLiveMetrics(viaje);
    const currentStopIndex = Math.max(0, Math.trunc(Number(metrics.stopIndex) || 0));
    const remainingWaypointPoints = waypointPoints.filter(
        (_, index) => (index + 1) >= currentStopIndex
    );
    const liveHeading = normalizeHeadingDegrees(
        viaje?.liveNavigation?.heading ??
        viaje?.liveHeading ??
        0
    );

    const firstPathPoint = visiblePath[0];
    const middlePathPoint = visiblePath[Math.floor(visiblePath.length / 2)];
    const lastPathPoint = visiblePath[visiblePath.length - 1];

    const pathSignature = [
        visiblePath.length,
        firstPathPoint?.lat,
        firstPathPoint?.lng,
        middlePathPoint?.lat,
        middlePathPoint?.lng,
        lastPathPoint?.lat,
        lastPathPoint?.lng,
        viaje?.liveRouteUpdatedAt,
        viaje?.liveNavigation?.updatedAt
    ].join('|');

    const adjustMap = useCallback((map) => {
        if (!map || !window.google?.maps) return;

        try {
            if (typeof map.setTilt === 'function' && Number(map.getTilt?.()) !== 0) {
                map.setTilt(0);
            }

            if (followDriver && driverPoint) {
                map.panTo(driverPoint);

                const targetZoom = expanded ? 17 : 16;
                const currentZoom = Number(map.getZoom?.());
                if (!Number.isFinite(currentZoom) || Math.abs(currentZoom - targetZoom) >= 1) {
                    map.setZoom(targetZoom);
                }

                const currentHeading = normalizeHeadingDegrees(map.getHeading?.() || 0);
                if (
                    typeof map.setHeading === 'function' &&
                    getHeadingDifference(currentHeading, liveHeading) >= 8
                ) {
                    map.setHeading(liveHeading);
                }

                return;
            }

            if (typeof map.setHeading === 'function') {
                map.setHeading(0);
            }

            const points = [
                ...visiblePath,
                currentStopIndex <= 0 ? startPoint : null,
                ...remainingWaypointPoints,
                endPoint,
                driverPoint
            ].filter(Boolean);

            if (points.length > 1) {
                const bounds = new window.google.maps.LatLngBounds();
                points.forEach(point => bounds.extend({ lat: point.lat, lng: point.lng }));
                map.fitBounds(bounds, expanded ? 45 : 30);
                return;
            }

            if (points[0]) {
                map.panTo(points[0]);
                map.setZoom(15);
            }
        } catch (error) {
            console.error('No se pudo ajustar el mapa del cliente:', error);
        }
    }, [
        expanded,
        followDriver,
        driverPoint?.lat,
        driverPoint?.lng,
        startPoint?.lat,
        startPoint?.lng,
        endPoint?.lat,
        endPoint?.lng,
        liveHeading,
        pathSignature,
        currentStopIndex,
        remainingWaypointPoints.length
    ]);

    const handleLoad = useCallback((map) => {
        mapRef.current = map;
        adjustMap(map);

        setTimeout(() => {
            try {
                if (window.google?.maps?.event) {
                    window.google.maps.event.trigger(map, 'resize');
                }
                adjustMap(map);
            } catch (_) {}
        }, 250);
    }, [adjustMap]);

    useEffect(() => {
        if (mapRef.current) adjustMap(mapRef.current);
    }, [adjustMap]);

    useEffect(() => {
        const handleResume = () => {
            if (document.visibilityState && document.visibilityState !== 'visible') return;

            setTimeout(() => {
                if (!mapRef.current) return;
                try {
                    if (window.google?.maps?.event) {
                        window.google.maps.event.trigger(mapRef.current, 'resize');
                    }
                    adjustMap(mapRef.current);
                } catch (_) {}
            }, 350);
        };

        document.addEventListener('visibilitychange', handleResume);
        window.addEventListener('pageshow', handleResume);
        window.addEventListener('focus', handleResume);

        return () => {
            document.removeEventListener('visibilitychange', handleResume);
            window.removeEventListener('pageshow', handleResume);
            window.removeEventListener('focus', handleResume);
        };
    }, [adjustMap]);

    useEffect(() => {
        if (!onMetricsChange || !viaje?.id) return;
        onMetricsChange(viaje.id, metrics);
    }, [
        viaje?.id,
        metrics.totalDistance,
        metrics.totalDuration,
        metrics.nextStopDistance,
        metrics.nextStopDuration,
        metrics.isLive,
        metrics.updatedAt,
        onMetricsChange
    ]);

    const driverIcon = getDriverCarIcon();

    return (
        <div className="relative w-full h-full">
            <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={center}
                zoom={driverPoint ? 16 : 14}
                onLoad={handleLoad}
                onUnmount={() => { mapRef.current = null; }}
                options={{
                    mapId: GOOGLE_VECTOR_MAP_ID,
                    disableDefaultUI: true,
                    gestureHandling: 'greedy',
                    backgroundColor: '#e2e8f0',
                    clickableIcons: false,
                    keyboardShortcuts: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    streetViewControl: false,
                    rotateControl: false,
                    tilt: 0,
                    heading: 0
                }}
            >
                {visiblePath.length > 0 && (
                    <Polyline
                        path={visiblePath}
                        options={{
                            strokeColor: '#f97316',
                            strokeOpacity: 0.95,
                            strokeWeight: expanded ? 7 : 6
                        }}
                    />
                )}

                {currentStopIndex <= 0 && startPoint && (
                    <Marker position={startPoint} label="A" />
                )}

                {remainingWaypointPoints.map((point) => {
                    const originalIndex = waypointPoints.findIndex(
                        waypoint => waypoint.lat === point.lat && waypoint.lng === point.lng
                    );

                    return (
                        <Marker
                            key={`tracking-waypoint-${originalIndex}`}
                            position={point}
                            label={String(originalIndex + 1)}
                        />
                    );
                })}

                {endPoint && <Marker position={endPoint} label="B" />}

                {driverPoint && (
                    <Marker
                        position={driverPoint}
                        icon={driverIcon}
                        zIndex={999}
                    />
                )}
            </GoogleMap>

            <button
                type="button"
                onClick={() => onDriverInfoClick?.(viaje)}
                disabled={!onDriverInfoClick || !viaje?.driver}
                className={`absolute top-3 left-3 bg-white/95 backdrop-blur px-3 py-2 rounded-full shadow-lg border border-slate-200 flex items-center gap-2 transition ${onDriverInfoClick && viaje?.driver ? 'cursor-pointer hover:bg-orange-50 hover:border-orange-300 active:scale-95' : 'cursor-default'}`}
                aria-label={metrics.isLive ? 'Ver datos del conductor' : 'Información de ruta planificada'}
            >
                <span className={`w-2.5 h-2.5 rounded-full ${metrics.isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
                <span className="text-[10px] font-black uppercase text-slate-600">
                    {metrics.isLive ? 'Datos del conductor' : 'Ruta planificada'}
                </span>
            </button>
        </div>
    );
};


function App() {
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
  const [waypoints, setWaypoints] = useState([]);
  const [isLocatingOrigin, setIsLocatingOrigin] = useState(false);
  const [frequentLocations, setFrequentLocations] = useState([]);
  const [routeReview, setRouteReview] = useState(null);
  const [isConfirmingTrip, setIsConfirmingTrip] = useState(false);

  // --- Datos ---
  const [misViajes, setMisViajes] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
      try { return JSON.parse(localStorage.getItem('triplogix_dismissed_arrival_alerts') || '[]'); } catch (_) { return []; }
  });
  const [activeChatTripId, setActiveChatTripId] = useState(null);
  const [expandedMapTripId, setExpandedMapTripId] = useState(null);
  const [followExpandedMap, setFollowExpandedMap] = useState(true);
  const [liveTripMetrics, setLiveTripMetrics] = useState({});
  const [driverDetailsTrip, setDriverDetailsTrip] = useState(null);
  const [driverDetails, setDriverDetails] = useState(null);
  const [driverDetailsLoading, setDriverDetailsLoading] = useState(false);
  const [driverDetailsError, setDriverDetailsError] = useState('');
  const [sharedTripId] = useState(() => {
      try { return new URLSearchParams(window.location.search).get('trip') || ''; } catch (_) { return ''; }
  });
  const [sharedTrip, setSharedTrip] = useState(null);
  const [sharedTripLoading, setSharedTripLoading] = useState(Boolean(sharedTripId));
  const [finishedTripNotice, setFinishedTripNotice] = useState(null);
  const [chatText, setChatText] = useState('');
  const chatScrollRef = useRef(null);
  
  // Ref para detectar cambios y hacer sonar la alerta
  const prevTripsRef = useRef({});
  const reassignmentInProgressRef = useRef(new Set());
  const tripsUnsubscribeRef = useRef(null);

  // --- Billetera ---
  const [clientSecret, setClientSecret] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [iniciandoStripe, setIniciandoStripe] = useState(false);
  const [selectedPaymentTripId, setSelectedPaymentTripId] = useState(null);

  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries, language: 'es', region: 'MX' });
  const originRef = useRef(null);
  const destRef = useRef(null);
  const waypointRefs = useRef([]);

  const handleLiveMetricsChange = useCallback((tripId, metrics) => {
    if (!tripId || !metrics) return;

    setLiveTripMetrics(prev => {
        const current = prev[tripId] || {};
        const same =
            current.totalDistance === metrics.totalDistance &&
            current.totalDuration === metrics.totalDuration &&
            current.nextStopDistance === metrics.nextStopDistance &&
            current.nextStopDuration === metrics.nextStopDuration &&
            current.isLive === metrics.isLive;

        if (same) return prev;

        return {
            ...prev,
            [tripId]: metrics
        };
    });
  }, []);

  const openDriverDetails = useCallback((trip) => {
      if (!trip) return;
      setDriverDetailsTrip(trip);
      setDriverDetails(mergeDriverDetails(trip));
      setDriverDetailsError('');
  }, []);

  const closeDriverDetails = useCallback(() => {
      setDriverDetailsTrip(null);
      setDriverDetails(null);
      setDriverDetailsLoading(false);
      setDriverDetailsError('');
  }, []);

  useEffect(() => {
      if (!driverDetailsTrip) return undefined;

      const fallback = mergeDriverDetails(driverDetailsTrip);
      setDriverDetails(fallback);
      setDriverDetailsError('');

      if (!driverDetailsTrip.driverId) {
          setDriverDetailsLoading(false);
          setDriverDetailsError('El viaje todavía no tiene un perfil de conductor vinculado.');
          return undefined;
      }

      setDriverDetailsLoading(true);

      const unsubscribe = onSnapshot(
          doc(db, 'conductores', driverDetailsTrip.driverId),
          (snapshot) => {
              if (snapshot.exists()) {
                  setDriverDetails(mergeDriverDetails(driverDetailsTrip, {
                      id: snapshot.id,
                      ...snapshot.data()
                  }));
                  setDriverDetailsError('');
              } else {
                  setDriverDetails(fallback);
                  setDriverDetailsError('No se encontró el perfil completo del conductor.');
              }
              setDriverDetailsLoading(false);
          },
          (driverError) => {
              console.error('No se pudieron cargar los datos del conductor:', driverError);
              setDriverDetails(fallback);
              setDriverDetailsError('No fue posible actualizar los datos del conductor en este momento.');
              setDriverDetailsLoading(false);
          }
      );

      return unsubscribe;
  }, [driverDetailsTrip?.id, driverDetailsTrip?.driverId]);

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


  useEffect(() => {
      if (!sharedTripId) return undefined;

      setSharedTripLoading(true);
      const unsubscribe = onSnapshot(
          doc(db, 'rutas', sharedTripId),
          (snapshot) => {
              setSharedTrip(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
              setSharedTripLoading(false);
          },
          (sharedError) => {
              console.error('No se pudo abrir el seguimiento compartido:', sharedError);
              setSharedTrip(null);
              setSharedTripLoading(false);
          }
      );

      return unsubscribe;
  }, [sharedTripId]);

  useEffect(() => {
      if (!currentUser?.id) return undefined;

      let disposed = false;
      let cleanupPush = null;

      const initializePush = async () => {
          try {
              cleanupPush = await setupPushNotifications({
                  onToken: async (token) => {
                      if (!token || disposed) return;
                      try {
                          await updateDoc(doc(db, 'clientes', currentUser.id), {
                              pushToken: token,
                              pushPlatform: 'capacitor-fcm',
                              pushUpdatedAt: new Date().toISOString()
                          });
                      } catch (tokenError) {
                          console.error('No se pudo guardar el token del cliente:', tokenError);
                      }
                  },
                  onNotification: () => {
                      playAlertSound();
                      if ('vibrate' in navigator) navigator.vibrate([250, 100, 350]);
                      setActiveTab('historial');
                  },
                  onAction: () => {
                      setActiveTab('historial');
                  }
              });
          } catch (pushError) {
              console.warn('Notificaciones no disponibles:', pushError);
          }
      };

      initializePush();

      return () => {
          disposed = true;
          cleanupPush?.();
      };
  }, [currentUser?.id]);

  const cargarDatosPerfil = (user) => {
    setName(user.name || ''); setPhone(user.phone || ''); 
    setPassword(user.password || '');
    setAccountType(user.type || 'Individual');
    setFrequentLocations(
        (Array.isArray(user.locations) ? user.locations : [])
            .map(normalizeFrequentLocation)
            .filter(Boolean)
            .slice(0, 8)
    );
  };

  const escucharMisViajes = (clientName) => {
    if (!clientName) return;

    tripsUnsubscribeRef.current?.();

    const q = query(collection(db, 'rutas'), where('client', '==', clientName));
    tripsUnsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const viajes = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      viajes.sort((a, b) => new Date(b.createdDate || 0) - new Date(a.createdDate || 0));
      setMisViajes(viajes);
    }, (snapshotError) => {
      console.error('No se pudieron escuchar los viajes:', snapshotError);
    });
  };

  useEffect(() => () => {
      tripsUnsubscribeRef.current?.();
  }, []);


  const obtenerConductorDisponible = useCallback(async (originPoint, excludedDriverIds = []) => {
      const excluded = new Set((excludedDriverIds || []).filter(Boolean));
      const origin = normalizePoint(originPoint);

      const [driversSnapshot, activeRoutesSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'conductores'), where('isOnline', '==', true))),
          getDocs(query(collection(db, 'rutas'), where('status', '==', 'En Ruta')))
      ]);

      const busyDriverIds = new Set(
          activeRoutesSnapshot.docs
              .map(item => item.data()?.driverId)
              .filter(Boolean)
      );

      const candidates = driversSnapshot.docs
          .map(item => ({ id: item.id, ...item.data() }))
          .filter(driver => driver.status === 'Aprobado')
          .filter(driver => driver.isOnline === true)
          .filter(driver => !busyDriverIds.has(driver.id))
          .filter(driver => !excluded.has(driver.id))
          .map(driver => {
              const driverLocation = normalizePoint(driver.currentLocation);
              const distanceMeters = origin && driverLocation
                  ? getDistanceMeters(origin, driverLocation)
                  : Number.POSITIVE_INFINITY;

              return {
                  ...driver,
                  driverLocation,
                  distanceMeters
              };
          })
          .sort((a, b) => {
              const aHasLocation = Number.isFinite(a.distanceMeters);
              const bHasLocation = Number.isFinite(b.distanceMeters);

              if (aHasLocation && !bHasLocation) return -1;
              if (!aHasLocation && bHasLocation) return 1;
              if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
              return String(a.name || '').localeCompare(String(b.name || ''));
          });

      return candidates[0] || null;
  }, []);

  const guardarDireccionesFrecuentes = useCallback(async (locationsToSave) => {
      if (!currentUser?.id) return;

      const merged = mergeFrequentLocations(frequentLocations, locationsToSave, 8);
      setFrequentLocations(merged);

      const updatedUser = {
          ...currentUser,
          locations: merged
      };

      setCurrentUser(updatedUser);
      localStorage.setItem('client_session', JSON.stringify(updatedUser));

      try {
          await updateDoc(doc(db, 'clientes', currentUser.id), {
              locations: merged
          });
      } catch (error) {
          console.error('No se pudieron guardar las direcciones frecuentes:', error);
      }
  }, [currentUser, frequentLocations]);

  const usarDireccionFrecuente = (location, target) => {
      const normalized = normalizeFrequentLocation(location);
      if (!normalized) return;

      const coords = { lat: normalized.lat, lng: normalized.lng };

      if (target === 'origen') {
          setOrigen(normalized.address);
          setOrigenCoords(coords);
      } else {
          setDestino(normalized.address);
          setDestinoCoords(coords);
      }
  };

  const limpiarOrigen = () => {
      setOrigen('');
      setOrigenCoords(null);
  };

  const limpiarDestino = () => {
      setDestino('');
      setDestinoCoords(null);
  };


  const agregarParada = () => {
      setWaypoints(prev => {
          if (prev.length >= 5) {
              alert('Puedes agregar hasta 5 puntos intermedios.');
              return prev;
          }

          return [
              ...prev,
              {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  address: '',
                  coords: null
              }
          ];
      });
  };

  const actualizarParada = (index, changes) => {
      setWaypoints(prev => prev.map((waypoint, waypointIndex) => (
          waypointIndex === index ? { ...waypoint, ...changes } : waypoint
      )));
  };

  const eliminarParada = (index) => {
      setWaypoints(prev => prev.filter((_, waypointIndex) => waypointIndex !== index));
  };

  const usarUbicacionActualComoOrigen = () => {
      if (!('geolocation' in navigator)) {
          alert('Este dispositivo no permite obtener la ubicación actual.');
          return;
      }

      setIsLocatingOrigin(true);

      navigator.geolocation.getCurrentPosition(
          async (position) => {
              const coords = {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude
              };

              setOrigenCoords(coords);

              try {
                  if (window.google?.maps?.Geocoder) {
                      const geocoder = new window.google.maps.Geocoder();
                      const response = await geocoder.geocode({ location: coords });
                      const address = response?.results?.[0]?.formatted_address;
                      setOrigen(address || 'Ubicación actual');
                  } else {
                      setOrigen('Ubicación actual');
                  }
              } catch (geocoderError) {
                  console.warn('No se pudo obtener la dirección:', geocoderError);
                  setOrigen('Ubicación actual');
              } finally {
                  setIsLocatingOrigin(false);
              }
          },
          (locationError) => {
              console.error('No se pudo obtener la ubicación:', locationError);
              setIsLocatingOrigin(false);
              alert('Activa la ubicación precisa y vuelve a intentarlo.');
          },
          {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 15000
          }
      );
  };

  const compartirSeguimiento = async (viaje) => {
      if (!viaje?.id) return;

      const officialBase = 'https://app-cliente-five.vercel.app';
      const rawConfiguredBase = String(
          import.meta.env.VITE_PUBLIC_APP_URL || officialBase
      )
          .trim()
          .replace(/\/$/, '');

      const configuredBase = rawConfiguredBase.includes('app-angel-three.vercel.app')
          ? officialBase
          : rawConfiguredBase;

      const runtimeBase = (
          /^https?:$/.test(window.location.protocol) &&
          !['localhost', '127.0.0.1'].includes(window.location.hostname)
      ) ? window.location.origin : '';

      const baseUrl = configuredBase || runtimeBase || officialBase;

      if (!baseUrl) {
          alert('Configura VITE_PUBLIC_APP_URL con la URL pública de TripLogix y vuelve a compilar.');
          return;
      }

      const url = `${baseUrl}/?trip=${encodeURIComponent(viaje.id)}`;
      const title = 'Seguimiento TripLogix';
      const text = `Sigue en tiempo real el viaje de ${viaje.client || 'TripLogix'}.`;

      try {
          if (Capacitor.isNativePlatform()) {
              await Share.share({
                  title,
                  text,
                  url,
                  dialogTitle: 'Compartir seguimiento TripLogix'
              });
              return;
          }

          if (navigator.share) {
              await navigator.share({ title, text, url });
              return;
          }

          await navigator.clipboard.writeText(url);
          alert('Enlace de seguimiento copiado.');
      } catch (shareError) {
          if (shareError?.name === 'AbortError') return;
          console.error('No se pudo compartir el seguimiento:', shareError);
          window.prompt('Copia este enlace de seguimiento:', url);
      }
  };

  // Reasignación automática cuando un conductor rechaza la oferta.
  // El flujo principal sigue siendo: cliente solicita -> conductor cercano recibe oferta -> conductor acepta.
  useEffect(() => {
      const candidates = misViajes.filter(viaje =>
          viaje.status === 'Pendiente' &&
          viaje.ofertaEstado === 'Rechazada' &&
          !viaje.ofertaPara
      );

      candidates.forEach(async (viaje) => {
          if (reassignmentInProgressRef.current.has(viaje.id)) return;
          reassignmentInProgressRef.current.add(viaje.id);

          try {
              const excluded = [
                  ...(Array.isArray(viaje.assignmentTriedDriverIds) ? viaje.assignmentTriedDriverIds : []),
                  ...(Array.isArray(viaje.rechazadoPor) ? viaje.rechazadoPor : [])
              ];

              const nextDriver = await obtenerConductorDisponible(viaje.startCoords, excluded);

              if (nextDriver) {
                  await updateDoc(doc(db, 'rutas', viaje.id), {
                      ofertaPara: nextDriver.id,
                      ofertaParaNombre: nextDriver.name || 'Conductor',
                      ofertaEstado: 'Pendiente',
                      assignmentStatus: 'Oferta enviada',
                      assignmentTriedDriverIds: Array.from(new Set([...excluded, nextDriver.id])),
                      lastAssignmentAt: new Date().toISOString()
                  });
              } else {
                  await updateDoc(doc(db, 'rutas', viaje.id), {
                      ofertaPara: '',
                      ofertaParaNombre: '',
                      ofertaEstado: 'Sin disponibilidad',
                      assignmentStatus: 'Sin conductores disponibles',
                      lastAssignmentAt: new Date().toISOString()
                  });
              }
          } catch (error) {
              console.error('No se pudo reasignar el viaje:', error);
          } finally {
              setTimeout(() => {
                  reassignmentInProgressRef.current.delete(viaje.id);
              }, 15000);
          }
      });
  }, [misViajes, obtenerConductorDisponible]);

  // Cierra automáticamente el mapa expandido cuando el conductor finaliza el viaje.
  // Así el usuario no se queda viendo una ruta que ya terminó.
  useEffect(() => {
      if (!expandedMapTripId) return;

      const trackedTrip = misViajes.find(item => item.id === expandedMapTripId);
      if (!trackedTrip || trackedTrip.status !== 'Finalizado') return;

      setExpandedMapTripId(null);
      setFinishedTripNotice(trackedTrip);
      setActiveTab('historial');
      setLiveTripMetrics(prev => {
          if (!prev[trackedTrip.id]) return prev;
          const next = { ...prev };
          delete next[trackedTrip.id];
          return next;
      });

      playAlertSound();
      if ('vibrate' in navigator) navigator.vibrate([250, 100, 450]);
  }, [misViajes, expandedMapTripId]);

  useEffect(() => {
      try {
          localStorage.setItem('triplogix_dismissed_arrival_alerts', JSON.stringify(dismissedAlerts.slice(-100)));
      } catch (_) {}
  }, [dismissedAlerts]);

  const acknowledgeArrival = async (trip) => {
      if (!trip?.id) return;

      const alertKey = getProximityAlertKey(trip);
      const stage = getArrivalStageInfo(trip);
      const acknowledgementText = getArrivalAcknowledgementText(trip);
      const nowIso = new Date().toISOString();
      const response = {
          eventId: `${trip.id}-client-response-${stage.stopIndex}-${Date.now()}`,
          type: 'client_arrival_acknowledgement',
          stopIndex: stage.stopIndex,
          passenger: stage.target || currentUser?.name || 'Cliente',
          response: acknowledgementText,
          timestamp: nowIso,
          time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      };

      setDismissedAlerts(prev => [...new Set([...prev, alertKey])]);

      try {
          await updateDoc(doc(db, 'rutas', trip.id), {
              arrivalAcknowledgements: arrayUnion(response),
              stopEvents: arrayUnion(response),
              chat: arrayUnion({
                  sender: 'Cliente',
                  text: `${acknowledgementText} · ${stage.target || 'Punto confirmado'}`,
                  time: response.time,
                  timestamp: nowIso,
                  stopIndex: stage.stopIndex,
                  systemAcknowledgement: true
              }),
              [`arrivalResponses.${stage.stopIndex}`]: response
          });
      } catch (ackError) {
          console.error('No se pudo guardar la confirmación del cliente:', ackError);
      }
  };

  const openPaymentForTrip = (trip) => {
      setSelectedPaymentTripId(trip?.id || null);
      setActiveTab('billetera');
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

  const arrivingTrip = misViajes.find(v => v.status === 'En Ruta' && v.proximityAlert?.active && !dismissedAlerts.includes(getProximityAlertKey(v)));

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

    if (!origen || !destino) return alert('Ingresa origen y destino');
    if (!origenCoords || !destinoCoords) {
        return alert('Selecciona origen y destino desde las sugerencias de Google Maps, tus direcciones frecuentes o tu ubicación actual.');
    }

    const invalidWaypoint = waypoints.find(waypoint => !waypoint.address || !waypoint.coords);
    if (invalidWaypoint) {
        return alert('Selecciona cada punto intermedio desde las sugerencias de Google Maps o elimina el que esté vacío.');
    }

    if (tipoServicio === 'Programado' && (!fecha || !hora)) {
        return alert('Ingresa fecha y hora para programar');
    }
    if (!isLoaded || !window.google?.maps?.DirectionsService) {
        return alert('Google Maps todavía está cargando. Espera unos segundos e inténtalo nuevamente.');
    }

    setLoading(true);

    try {
      const directionsService = new window.google.maps.DirectionsService();
      const results = await directionsService.route({
          origin: origenCoords,
          destination: destinoCoords,
          waypoints: waypoints.map(waypoint => ({
              location: waypoint.coords,
              stopover: true
          })),
          optimizeWaypoints: false,
          travelMode: window.google.maps.TravelMode.DRIVING,
      });

      const routeData = results?.routes?.[0];
      const legs = routeData?.legs || [];

      if (!routeData || legs.length === 0) {
          throw new Error('Google Maps no devolvió una ruta válida.');
      }

      const distanceValue = legs.reduce((total, leg) => total + (leg.distance?.value || 0), 0);
      const durationValue = legs.reduce((total, leg) => total + (leg.duration?.value || 0), 0);
      const distanceKm = (distanceValue / 1000).toFixed(1);
      const durationMin = Math.max(1, Math.round(durationValue / 60));
      const firstLegDistanceKm = ((legs[0]?.distance?.value || 0) / 1000).toFixed(1);
      const firstLegDurationMin = Math.max(1, Math.round((legs[0]?.duration?.value || 0) / 60));
      const geometry = routeData.overview_path.map(point => ({
          lat: point.lat(),
          lng: point.lng()
      }));

      const scheduledDate = tipoServicio === 'Programado'
          ? fecha
          : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

      const scheduledTime = tipoServicio === 'Programado'
          ? hora
          : new Date().toLocaleTimeString('es-MX', {
              timeZone: 'America/Mexico_City',
              hour: '2-digit',
              minute: '2-digit'
          });

      const estimatedPricing = calculateTripLogixFare({
          technicalData: { totalDistance: distanceKm, totalDuration: durationMin }
      });
      const estimatedCost = estimatedPricing.total.toFixed(2);
      const nowIso = new Date().toISOString();

      const waypointAddresses = waypoints.map(waypoint => waypoint.address);
      const waypointData = waypoints.map((waypoint, index) => ({
          lat: waypoint.coords.lat,
          lng: waypoint.coords.lng,
          address: waypoint.address,
          label: `Parada ${index + 1}`,
          passengerName: currentUser.name,
          contact: currentUser.phone
      }));

      const routePayload = {
        client: currentUser.name || 'Cliente',
        requestUser: currentUser.phone || '',
        clientPhone: currentUser.phone || '',
        start: origen,
        startCoords: {
            lat: origenCoords.lat,
            lng: origenCoords.lng,
            passengerName: currentUser.name,
            contact: currentUser.phone
        },
        end: destino,
        endCoords: {
            lat: destinoCoords.lat,
            lng: destinoCoords.lng,
            passengerName: currentUser.name,
            contact: currentUser.phone
        },
        serviceType: tipoServicio,
        scheduledDate,
        scheduledTime,
        status: 'Pendiente',
        createdDate: nowIso,
        driverId: '',
        driver: '',
        waypoints: waypointAddresses,
        waypointsData: waypointData,
        chat: [],
        assignmentStatus: 'Preparando asignación',
        assignmentTriedDriverIds: [],
        pricingStatus: 'Pendiente de cálculo del conductor',
        liveNavigation: {
            distanceKm: Number(distanceKm),
            durationMinutes: durationMin,
            nextStopDistanceKm: Number(firstLegDistanceKm),
            nextStopDurationMinutes: firstLegDurationMin,
            stopIndex: 0,
            source: 'client-planned',
            updatedAt: nowIso
        },
        technicalData: {
            totalDistance: distanceKm,
            totalDuration: durationMin,
            geometry
        }
      };

      setRouteReview({
          routePayload,
          distanceKm,
          durationMin,
          estimatedCost,
          scheduledDate,
          scheduledTime
      });
    } catch (err) {
        console.error(err);
        alert('Error calculando la ruta. Verifica tu conexión, las paradas o intenta con otra dirección.');
    } finally {
        setLoading(false);
    }
  };

  const confirmarSolicitudViaje = async () => {
      if (!routeReview?.routePayload || isConfirmingTrip) return;

      setIsConfirmingTrip(true);

      try {
          const baseRoute = routeReview.routePayload;
          const conductor = await obtenerConductorDisponible(baseRoute.startCoords, []);
          const nowIso = new Date().toISOString();

          const assignmentData = conductor
              ? {
                    ofertaPara: conductor.id,
                    ofertaParaNombre: conductor.name || 'Conductor',
                    ofertaEstado: 'Pendiente',
                    assignmentStatus: 'Oferta enviada',
                    assignmentTriedDriverIds: [conductor.id],
                    assignmentRequestedAt: nowIso,
                    assignmentDistanceMeters: Number.isFinite(conductor.distanceMeters)
                        ? Math.round(conductor.distanceMeters)
                        : null
                }
              : {
                    ofertaPara: '',
                    ofertaParaNombre: '',
                    ofertaEstado: 'Sin disponibilidad',
                    assignmentStatus: 'Sin conductores disponibles',
                    assignmentTriedDriverIds: [],
                    assignmentRequestedAt: nowIso
                };

          await addDoc(collection(db, 'rutas'), {
              ...baseRoute,
              ...assignmentData
          });

          await guardarDireccionesFrecuentes([
              {
                  label: baseRoute.start.split(',')[0] || 'Origen frecuente',
                  address: baseRoute.start,
                  lat: baseRoute.startCoords.lat,
                  lng: baseRoute.startCoords.lng,
                  updatedAt: nowIso
              },
              {
                  label: baseRoute.end.split(',')[0] || 'Destino frecuente',
                  address: baseRoute.end,
                  lat: baseRoute.endCoords.lat,
                  lng: baseRoute.endCoords.lng,
                  updatedAt: nowIso
              }
          ]);

          if (conductor) {
              alert(`¡Viaje solicitado! Se envió la solicitud al conductor disponible más cercano: ${conductor.name || 'Conductor'}.`);
          } else {
              alert('¡Viaje solicitado! En este momento no hay conductores conectados; la solicitud quedó registrada para asignación.');
          }

          setRouteReview(null);
          limpiarOrigen();
          limpiarDestino();
          setWaypoints([]);
          setFecha('');
          setHora('');
          setActiveTab('historial');
      } catch (error) {
          console.error('Error confirmando viaje:', error);
          alert('No fue posible registrar el viaje. Revisa tu conexión e inténtalo nuevamente.');
      } finally {
          setIsConfirmingTrip(false);
      }
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

  if (sharedTripId) {
      const sharedMetrics = sharedTrip ? getAuthoritativeLiveMetrics(sharedTrip) : null;
      const sharedPricing = sharedTrip ? getDriverPublishedPricing(sharedTrip) : null;

      return (
          <div className="min-h-screen bg-slate-950 font-sans flex flex-col">
              <div className="bg-slate-900 text-white p-5 shadow-lg">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">TripLogix · Seguimiento compartido</p>
                  <h1 className="text-xl font-black mt-1">
                      {sharedTrip?.status === 'Finalizado' ? 'Viaje finalizado' : 'Viaje en tiempo real'}
                  </h1>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                      {sharedTrip?.end || 'Cargando información del viaje...'}
                  </p>
              </div>

              <div className="flex-1 min-h-[55vh] relative">
                  {sharedTripLoading || !isLoaded ? (
                      <div className="absolute inset-0 flex items-center justify-center text-white">
                          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                      </div>
                  ) : sharedTrip ? (
                      <LiveTrackingMap
                          viaje={sharedTrip}
                          expanded={true}
                          followDriver={sharedTrip.status === 'En Ruta'}
                          onMetricsChange={handleLiveMetricsChange}
                      />
                  ) : (
                      <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white">
                          <div>
                              <X className="w-12 h-12 mx-auto text-red-400 mb-3" />
                              <p className="font-black">El viaje no existe o ya no está disponible.</p>
                          </div>
                      </div>
                  )}
              </div>

              {sharedTrip && (
                  <div className="bg-white p-5 rounded-t-[2rem] shadow-2xl">
                      <div className="grid grid-cols-2 gap-3">
                          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                              <p className="text-[10px] font-black uppercase text-orange-500">Distancia restante</p>
                              <p className="text-2xl font-black text-orange-900">{sharedMetrics?.totalDistance || '--'} <span className="text-sm">km</span></p>
                          </div>
                          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 text-right">
                              <p className="text-[10px] font-black uppercase text-green-600">Llegada en</p>
                              <p className="text-2xl font-black text-green-800">{sharedMetrics?.totalDuration || '--'} <span className="text-sm">min</span></p>
                          </div>
                      </div>
                      <div className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                          <div className="flex items-start justify-between gap-4">
                              <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400">Estado</p>
                                  <p className="font-black text-slate-800">{sharedTrip.status || 'Pendiente'}</p>
                                  <p className="text-xs text-slate-500 mt-1">Conductor: {getTripDriverLabel(sharedTrip)}</p>
                              </div>
                              {!sharedPricing?.hidden && (
                                  <div className="text-right">
                                      <p className="text-[10px] font-black uppercase text-slate-400">Tarifa</p>
                                      <p className="font-black text-orange-600">
                                          {sharedPricing?.available
                                              ? formatTripLogixMoney(sharedPricing.total, sharedPricing.currency)
                                              : 'Calculando...'}
                                      </p>
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  }

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
  const expandedMapTrip = misViajes.find(v => v.id === expandedMapTripId);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col relative">

      {finishedTripNotice && (
          <div className="fixed inset-0 z-[10020] bg-slate-900/85 backdrop-blur-md flex items-center justify-center p-5">
              <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden border-4 border-green-500">
                  <div className="bg-green-600 text-white p-6 text-center">
                      <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                          <CheckCircle2 className="w-9 h-9" />
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-green-100">Actualización en tiempo real</p>
                      <h2 className="text-2xl font-black mt-1">Viaje finalizado</h2>
                      <p className="text-sm text-green-100 mt-2">La navegación terminó y tu comprobante ya está disponible.</p>
                  </div>
                  <div className="p-5">
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                          <p className="text-[10px] font-black uppercase text-slate-400">Folio</p>
                          <p className="font-black text-slate-800 mt-1">{buildTripLogixReceipt(finishedTripNotice).folio}</p>
                          <div className="grid grid-cols-2 gap-3 mt-4">
                              <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400">Distancia</p>
                                  <p className="text-lg font-black text-slate-800">{buildTripLogixReceipt(finishedTripNotice).distanceKm.toFixed(2)} km</p>
                              </div>
                              <div className="text-right">
                                  <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                                  <p className="text-lg font-black text-orange-600">{formatTripLogixMoney(buildTripLogixReceipt(finishedTripNotice).pricing.total)}</p>
                              </div>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                          <button
                              type="button"
                              onClick={() => downloadTripLogixReceiptPdf(finishedTripNotice)}
                              className="p-4 rounded-2xl bg-orange-500 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                          >
                              <Download className="w-4 h-4" /> PDF
                          </button>
                          <button
                              type="button"
                              onClick={() => shareTripLogixReceiptPdf(finishedTripNotice)}
                              className="p-4 rounded-2xl bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                          >
                              <Share2 className="w-4 h-4" /> COMPARTIR
                          </button>
                      </div>
                      <button
                          type="button"
                          onClick={() => setFinishedTripNotice(null)}
                          className="w-full mt-3 p-3 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-widest"
                      >
                          Ver historial
                      </button>
                  </div>
              </div>
          </div>
      )}

      {routeReview && (
          <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-200">
                  <div className="bg-slate-800 text-white p-5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-300">Revisa antes de solicitar</p>
                      <h2 className="text-xl font-black mt-1">Confirma los datos de tu viaje</h2>
                      <p className="text-xs text-slate-300 mt-1">Puedes regresar y corregir cualquier dirección sin perder la información.</p>
                  </div>

                  <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                      <div className="rounded-2xl border border-slate-200 p-4">
                          <div className="flex gap-3">
                              <div className="mt-1 w-3 h-3 rounded-full bg-green-500 shrink-0"></div>
                              <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400">Origen</p>
                                  <p className="text-sm font-bold text-slate-800 mt-1">{routeReview.routePayload.start}</p>
                              </div>
                          </div>
                          {routeReview.routePayload.waypointsData?.map((waypoint, index) => (
                              <React.Fragment key={`review-waypoint-${index}`}>
                                  <div className="ml-1.5 h-5 border-l-2 border-dashed border-slate-200"></div>
                                  <div className="flex gap-3">
                                      <div className="mt-1 w-3 h-3 rounded-full bg-blue-500 shrink-0"></div>
                                      <div>
                                          <p className="text-[10px] font-black uppercase text-slate-400">Parada {index + 1}</p>
                                          <p className="text-sm font-bold text-slate-800 mt-1">{waypoint.address}</p>
                                      </div>
                                  </div>
                              </React.Fragment>
                          ))}
                          <div className="ml-1.5 h-5 border-l-2 border-dashed border-slate-200"></div>
                          <div className="flex gap-3">
                              <div className="mt-1 w-3 h-3 rounded-full bg-orange-500 shrink-0"></div>
                              <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400">Destino</p>
                                  <p className="text-sm font-bold text-slate-800 mt-1">{routeReview.routePayload.end}</p>
                              </div>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                              <p className="text-[10px] font-black uppercase text-orange-500">Distancia</p>
                              <p className="text-2xl font-black text-orange-900 mt-1">{routeReview.distanceKm} <span className="text-sm">km</span></p>
                          </div>
                          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 text-right">
                              <p className="text-[10px] font-black uppercase text-green-600">Tiempo estimado</p>
                              <p className="text-2xl font-black text-green-800 mt-1">{routeReview.durationMin} <span className="text-sm">min</span></p>
                          </div>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                          <div className="flex justify-between gap-4">
                              <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400">Servicio</p>
                                  <p className="text-sm font-black text-slate-800 mt-1">{routeReview.routePayload.serviceType}</p>
                              </div>
                              <div className="text-right">
                                  <p className="text-[10px] font-black uppercase text-slate-400">Fecha y hora</p>
                                  <p className="text-sm font-black text-slate-800 mt-1">{routeReview.scheduledDate} · {routeReview.scheduledTime}</p>
                              </div>
                          </div>
                          {!isCorporate && (
                              <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center">
                                  <p className="text-xs font-bold text-slate-500">Tarifa estimada</p>
                                  <p className="text-2xl font-black text-slate-800">${routeReview.estimatedCost}</p>
                              </div>
                          )}
                      </div>
                  </div>

                  <div className="p-5 pt-0 grid grid-cols-2 gap-3">
                      <button
                          type="button"
                          onClick={() => setRouteReview(null)}
                          disabled={isConfirmingTrip}
                          className="p-4 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-widest active:scale-95 transition disabled:opacity-50"
                      >
                          Corregir datos
                      </button>
                      <button
                          type="button"
                          onClick={confirmarSolicitudViaje}
                          disabled={isConfirmingTrip}
                          className="p-4 rounded-2xl bg-orange-500 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
                      >
                          {isConfirmingTrip ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                          Confirmar viaje
                      </button>
                  </div>
              </div>
          </div>
      )}

      {expandedMapTrip && (
          <div className="fixed inset-0 z-[9998] bg-slate-950 flex flex-col animate-[fadeIn_0.2s_ease-out]">
              <div className="bg-slate-900 text-white p-4 pt-6 flex items-center justify-between shadow-lg z-10 shrink-0">
                  <div>
                      <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Mapa expandido</p>
                      <h2 className="text-base font-black leading-tight">{expandedMapTrip.driver || 'Conductor'} en camino</h2>
                      <p className="text-[10px] text-slate-400 line-clamp-1">{expandedMapTrip.end}</p>
                  </div>
                  <button onClick={() => setExpandedMapTripId(null)} className="p-3 bg-white/10 rounded-full active:scale-95 transition">
                      <X className="w-5 h-5" />
                  </button>
              </div>

              <div className="flex-1 min-h-0 relative">
                  {isLoaded ? (
                      <LiveTrackingMap
                          viaje={expandedMapTrip}
                          expanded={true}
                          followDriver={followExpandedMap}
                          onMetricsChange={handleLiveMetricsChange}
                          onDriverInfoClick={openDriverDetails}
                      />
                  ) : (
                      <div className="w-full h-full flex items-center justify-center text-white">
                          <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
                      </div>
                  )}
              </div>

              <div className="bg-white p-4 rounded-t-[2rem] shadow-[0_-10px_35px_rgba(0,0,0,0.25)] shrink-0">
                  <div className="grid grid-cols-2 gap-3">
                      <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                          <p className="text-[10px] font-black uppercase text-orange-500">Distancia restante</p>
                          <p className="text-2xl font-black text-orange-900">
                              {getAuthoritativeLiveMetrics(expandedMapTrip).totalDistance} <span className="text-sm">km</span>
                          </p>
                      </div>
                      <div className="bg-green-50 border border-green-100 rounded-2xl p-4 text-right">
                          <p className="text-[10px] font-black uppercase text-green-600">Llegada en</p>
                          <p className="text-2xl font-black text-green-700">
                              {getAuthoritativeLiveMetrics(expandedMapTrip).totalDuration} <span className="text-sm">min</span>
                          </p>
                      </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                      <button
                          type="button"
                          onClick={() => setFollowExpandedMap(prev => !prev)}
                          className="bg-orange-50 border border-orange-200 text-orange-700 font-black p-3.5 rounded-2xl active:scale-95 transition flex items-center justify-center gap-2 text-xs"
                      >
                          <LocateFixed className="w-4 h-4" />
                          {followExpandedMap ? 'VER RUTA' : 'SEGUIR AUTO'}
                      </button>
                      <button onClick={() => setExpandedMapTripId(null)} className="bg-slate-800 text-white font-black p-3.5 rounded-2xl active:scale-95 transition text-xs">
                          CERRAR MAPA
                      </button>
                  </div>
              </div>
          </div>
      )}

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

      {driverDetailsTrip && (
          <div className="fixed inset-0 z-[10010] flex items-center justify-center p-5 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-200">
              <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-200">
                  <div className="bg-slate-900 text-white px-5 py-5 flex items-center justify-between">
                      <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Información verificada</p>
                          <h2 className="text-xl font-black mt-1">Datos del conductor</h2>
                      </div>
                      <button
                          type="button"
                          onClick={closeDriverDetails}
                          className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition"
                          aria-label="Cerrar datos del conductor"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="p-5">
                      {driverDetailsLoading && (
                          <div className="flex items-center justify-center gap-2 py-3 text-slate-500 text-xs font-bold">
                              <Loader2 className="w-4 h-4 animate-spin text-orange-500" /> Actualizando información...
                          </div>
                      )}

                      <div className="flex items-center gap-4 pb-5 border-b border-slate-100">
                          {driverDetails?.fotoPerfil ? (
                              <img
                                  src={driverDetails.fotoPerfil}
                                  alt={driverDetails.name || 'Conductor'}
                                  className="w-20 h-20 rounded-2xl object-cover border-2 border-orange-200 bg-slate-100"
                              />
                          ) : (
                              <div className="w-20 h-20 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center border-2 border-orange-200">
                                  <User className="w-9 h-9" />
                              </div>
                          )}

                          <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Conductor asignado</p>
                              <h3 className="text-lg font-black text-slate-800 truncate">{driverDetails?.name || 'Conductor asignado'}</h3>
                              {driverDetails?.rating !== null && driverDetails?.rating !== undefined && (
                                  <p className="text-xs font-bold text-orange-600 mt-1">★ {Number(driverDetails.rating).toFixed(1)} de calificación</p>
                              )}
                          </div>
                      </div>

                      <div className="space-y-3 mt-5">
                          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                              <Phone className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Teléfono</p>
                                  {driverDetails?.phone ? (
                                      <a href={`tel:${driverDetails.phone}`} className="text-sm font-bold text-slate-800 break-all hover:text-orange-600">
                                          {driverDetails.phone}
                                      </a>
                                  ) : (
                                      <p className="text-sm font-bold text-slate-500">No registrado</p>
                                  )}
                              </div>
                          </div>

                          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                              <Car className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vehículo</p>
                                  <p className="text-sm font-bold text-slate-800">
                                      {driverDetails?.vehicleModel || driverDetails?.vehicle || 'Unidad no registrada'}
                                  </p>
                                  {driverDetails?.vehicleType && (
                                      <p className="text-xs text-slate-500 mt-0.5">{driverDetails.vehicleType}</p>
                                  )}
                              </div>
                          </div>

                          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                              <ShieldCheck className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Placas</p>
                                  <p className="text-sm font-black text-slate-800 uppercase">
                                      {driverDetails?.vehiclePlate || 'No registradas'}
                                  </p>
                              </div>
                          </div>
                      </div>

                      {driverDetailsError && (
                          <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4">
                              {driverDetailsError}
                          </p>
                      )}

                      <button
                          type="button"
                          onClick={closeDriverDetails}
                          className="w-full mt-5 bg-slate-900 hover:bg-slate-800 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-xs active:scale-95 transition"
                      >
                          Cerrar
                      </button>
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
                      <p className="text-lg font-bold text-orange-600 leading-tight">
                          Tu conductor está llegando {getArrivalStageInfo(arrivingTrip).modalLabel} en <span className="text-3xl">{arrivingTrip.proximityAlert?.etaMins || 2}</span> min.
                      </p>
                      {getArrivalStageInfo(arrivingTrip).target && (
                          <p className="text-xs font-bold text-slate-500 mt-3 mb-6 px-3 line-clamp-2">
                              {getArrivalStageInfo(arrivingTrip).target}
                          </p>
                      )}
                      {!getArrivalStageInfo(arrivingTrip).target && <div className="mb-6"></div>}
                      <button onClick={() => acknowledgeArrival(arrivingTrip)} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black p-4 rounded-2xl shadow-xl active:scale-95 transition-all text-sm tracking-widest flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5"/> {getArrivalAcknowledgementText(arrivingTrip)}</button>
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
        <button onClick={() => { tripsUnsubscribeRef.current?.(); localStorage.removeItem('client_session'); setCurrentUser(null); }} className="p-2 bg-slate-50 text-slate-500 hover:text-red-500 rounded-full transition"><LogOut className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        
        {/* --- PESTAÑA: PEDIR VIAJE --- */}
        {activeTab === 'pedir' && (
          <div className="p-5 animate-[fadeIn_0.3s_ease-out]">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-1">¿A dónde vamos?</h1>
            <p className="text-xs text-slate-500 mb-4">Selecciona direcciones exactas y revisa los datos antes de confirmar.</p>

            <form onSubmit={handlePedirViaje} className="space-y-4">
              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 space-y-4">
                {isLoaded ? (
                  <>
                    <div>
                        <div className="relative">
                            <div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-green-500 z-10"></div>
                            <Autocomplete
                                onLoad={ref => originRef.current = ref}
                                onPlaceChanged={() => {
                                    const place = originRef.current?.getPlace();
                                    if (place?.geometry) {
                                        setOrigen(place.formatted_address || place.name || '');
                                        setOrigenCoords({
                                            lat: place.geometry.location.lat(),
                                            lng: place.geometry.location.lng()
                                        });
                                    }
                                }}
                            >
                                <input
                                    type="text"
                                    placeholder="Punto de origen"
                                    className="w-full pl-10 pr-11 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                                    value={origen}
                                    onChange={event => {
                                        setOrigen(event.target.value);
                                        setOrigenCoords(null);
                                    }}
                                    required
                                />
                            </Autocomplete>
                            {origen && (
                                <button
                                    type="button"
                                    onClick={limpiarOrigen}
                                    className="absolute right-2 top-2 p-2 text-slate-400 hover:text-red-500 z-20"
                                    aria-label="Limpiar origen"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={usarUbicacionActualComoOrigen}
                            disabled={isLocatingOrigin}
                            className="mt-2 w-full px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {isLocatingOrigin ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
                            Usar mi ubicación actual
                        </button>

                        {frequentLocations.length > 0 && (
                            <div className="mt-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Usar como origen</p>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {frequentLocations.map((location, index) => (
                                        <button
                                            key={`origin-frequent-${index}-${getFrequentLocationKey(location)}`}
                                            type="button"
                                            onClick={() => usarDireccionFrecuente(location, 'origen')}
                                            className="shrink-0 max-w-[190px] px-3 py-2 rounded-xl bg-green-50 border border-green-100 text-left active:scale-95 transition"
                                        >
                                            <p className="text-[10px] font-black text-green-700 truncate">{location.label}</p>
                                            <p className="text-[9px] text-slate-500 truncate">{location.address}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {waypoints.map((waypoint, index) => (
                        <React.Fragment key={waypoint.id}>
                            <div className="w-px h-5 bg-slate-200 ml-5 -my-2"></div>
                            <div className="relative">
                                <div className="absolute left-4 top-4 w-5 h-5 -translate-y-1 rounded-full bg-blue-500 text-white text-[9px] font-black flex items-center justify-center z-10">
                                    {index + 1}
                                </div>
                                <Autocomplete
                                    onLoad={ref => { waypointRefs.current[index] = ref; }}
                                    onPlaceChanged={() => {
                                        const place = waypointRefs.current[index]?.getPlace();
                                        if (place?.geometry) {
                                            actualizarParada(index, {
                                                address: place.formatted_address || place.name || '',
                                                coords: {
                                                    lat: place.geometry.location.lat(),
                                                    lng: place.geometry.location.lng()
                                                }
                                            });
                                        }
                                    }}
                                >
                                    <input
                                        type="text"
                                        placeholder={`Punto intermedio ${index + 1}`}
                                        className="w-full pl-11 pr-11 p-3 rounded-xl bg-blue-50/50 border border-blue-100 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={waypoint.address}
                                        onChange={event => actualizarParada(index, {
                                            address: event.target.value,
                                            coords: null
                                        })}
                                        required
                                    />
                                </Autocomplete>
                                <button
                                    type="button"
                                    onClick={() => eliminarParada(index)}
                                    className="absolute right-2 top-2 p-2 text-slate-400 hover:text-red-500 z-20"
                                    aria-label={`Eliminar parada ${index + 1}`}
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        </React.Fragment>
                    ))}

                    <button
                        type="button"
                        onClick={agregarParada}
                        disabled={waypoints.length >= 5}
                        className="w-full p-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 text-blue-700 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                        <PlusCircle className="w-4 h-4" />
                        Agregar punto intermedio opcional
                    </button>

                    <div className="w-px h-6 bg-slate-200 ml-5 -my-2"></div>

                    <div>
                        <div className="relative">
                            <div className="absolute left-4 top-4 w-3 h-3 rounded-full bg-orange-500 z-10"></div>
                            <Autocomplete
                                onLoad={ref => destRef.current = ref}
                                onPlaceChanged={() => {
                                    const place = destRef.current?.getPlace();
                                    if (place?.geometry) {
                                        setDestino(place.formatted_address || place.name || '');
                                        setDestinoCoords({
                                            lat: place.geometry.location.lat(),
                                            lng: place.geometry.location.lng()
                                        });
                                    }
                                }}
                            >
                                <input
                                    type="text"
                                    placeholder="Punto de destino"
                                    className="w-full pl-10 pr-11 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                                    value={destino}
                                    onChange={event => {
                                        setDestino(event.target.value);
                                        setDestinoCoords(null);
                                    }}
                                    required
                                />
                            </Autocomplete>
                            {destino && (
                                <button
                                    type="button"
                                    onClick={limpiarDestino}
                                    className="absolute right-2 top-2 p-2 text-slate-400 hover:text-red-500 z-20"
                                    aria-label="Limpiar destino"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>

                        {frequentLocations.length > 0 && (
                            <div className="mt-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Usar como destino</p>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {frequentLocations.map((location, index) => (
                                        <button
                                            key={`destination-frequent-${index}-${getFrequentLocationKey(location)}`}
                                            type="button"
                                            onClick={() => usarDireccionFrecuente(location, 'destino')}
                                            className="shrink-0 max-w-[190px] px-3 py-2 rounded-xl bg-orange-50 border border-orange-100 text-left active:scale-95 transition"
                                        >
                                            <p className="text-[10px] font-black text-orange-700 truncate">{location.label}</p>
                                            <p className="text-[9px] text-slate-500 truncate">{location.address}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Cargando mapas...
                  </div>
                )}
              </div>

              <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Tipo de Servicio</p>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => setTipoServicio('Prioritario')}
                        className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all ${tipoServicio === 'Prioritario' ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                    >
                        <Zap className="w-6 h-6" />
                        <span className="text-xs font-bold">Lo antes posible</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setTipoServicio('Programado')}
                        className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all ${tipoServicio === 'Programado' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                    >
                        <Calendar className="w-6 h-6" />
                        <span className="text-xs font-bold">Programar</span>
                    </button>
                </div>

                {tipoServicio === 'Programado' && (
                    <div className="mt-4 grid grid-cols-2 gap-3 animate-[fadeIn_0.2s_ease-out]">
                        <input
                            type="date"
                            className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-800"
                            value={fecha}
                            onChange={event => setFecha(event.target.value)}
                            required
                        />
                        <input
                            type="time"
                            className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-800"
                            value={hora}
                            onChange={event => setHora(event.target.value)}
                            required
                        />
                    </div>
                )}
              </div>

              <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black p-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-orange-500/20 active:scale-95 transition-all mt-4 disabled:opacity-60"
              >
                  {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                      <>
                          <CheckCircle className="w-5 h-5" />
                          REVISAR DATOS DEL VIAJE
                      </>
                  )}
              </button>
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
                    const arrivalStageInfo = getArrivalStageInfo(viaje);
                    const authoritativeMetrics = getAuthoritativeLiveMetrics(viaje);
                    const displayDistance = authoritativeMetrics.totalDistance;
                    const displayDuration = authoritativeMetrics.totalDuration;
                    const driverPricing = getDriverPublishedPricing(viaje);

                    return (
                        <div key={viaje.id} className={`bg-white rounded-[2rem] shadow-xl overflow-hidden border-2 transition-colors ${isArriving ? 'border-orange-500 shadow-orange-500/20' : 'border-slate-800'}`}>
                            <div className={`p-4 flex justify-between items-center text-white ${isArriving ? 'bg-orange-500' : 'bg-slate-800'}`}>
                                <div className="flex items-center gap-2 font-bold text-sm">
                                    {isArriving ? <BellRing className="w-4 h-4 animate-bounce" /> : <Navigation className="w-4 h-4 animate-pulse" />}
                                    {viaje.status === 'Pendiente' ? (viaje.ofertaEstado === 'Pendiente' ? 'CONFIRMANDO CONDUCTOR...' : 'ASIGNANDO UNIDAD...') : viaje.status === 'Aceptada' ? 'VIAJE ACEPTADO' : isArriving ? `¡${arrivalStageInfo.cardLabel}!` : 'VIAJE EN CURSO'}
                                </div>
                                <div className="text-[10px] font-black uppercase bg-black/20 px-2 py-1 rounded-lg">{viaje.serviceType}</div>
                            </div>

                            <div className="h-56 bg-slate-200 relative">
                                {isLoaded ? (
                                    <LiveTrackingMap
                                        viaje={viaje}
                                        onMetricsChange={handleLiveMetricsChange}
                                        onDriverInfoClick={openDriverDetails}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin"/></div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { setFollowExpandedMap(true); setExpandedMapTripId(viaje.id); }}
                                    className="absolute top-3 right-3 bg-white/95 backdrop-blur text-slate-800 border border-slate-200 shadow-lg rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition"
                                >
                                    Expandir
                                </button>
                                {viaje.status === 'En Ruta' && authoritativeMetrics.isLive && (
                                    <div className="absolute bottom-3 left-3 bg-slate-900/90 text-white rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest shadow-lg">
                                        Ruta en vivo
                                    </div>
                                )}
                            </div>

                            <div className="p-5">
                                {isCorporate ? (
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Briefcase className="w-3 h-3"/> Métrica Corporativa</p>
                                        <div className="flex justify-between items-center">
                                            <div><p className="text-[10px] font-bold text-slate-500 uppercase">Recorrido Total</p><p className="text-2xl font-black text-slate-800">{displayDistance} <span className="text-sm font-medium text-slate-500">km</span></p></div>
                                            <div className="w-px h-10 bg-slate-200"></div>
                                            <div className="text-right"><p className="text-[10px] font-bold text-slate-500 uppercase">Llegada Estimada</p><p className="text-2xl font-black text-orange-600">{displayDuration} <span className="text-sm font-medium text-orange-500">min</span></p></div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-3">
                                            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500"><User className="w-5 h-5"/></div>
                                            <div><p className="text-[10px] font-black text-slate-400 uppercase">Operador Asignado</p><p className="text-sm font-bold text-slate-800">{getTripDriverLabel(viaje)}</p></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center bg-orange-50 p-4 rounded-2xl border border-orange-100">
                                            <div><p className="text-[10px] font-black uppercase text-orange-500">Distancia</p><p className="text-xl font-black text-orange-900">{displayDistance} <span className="text-sm">km</span></p></div>
                                            <div className="text-right"><p className="text-[10px] font-black uppercase text-orange-500">Llegada en</p><p className="text-xl font-black text-orange-900">{displayDuration} <span className="text-sm">min</span></p></div>
                                        </div>
                                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                                            <div className="flex items-center gap-3"><div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500"><User className="w-6 h-6"/></div><div><p className="text-[10px] font-black text-slate-400 uppercase">Tu Conductor</p><p className="text-sm font-bold text-slate-800">{getTripDriverLabel(viaje)}</p>{viaje.driver && <p className="text-[10px] font-bold text-slate-400 mt-0.5">Unidad Estándar</p>}</div></div>
                                            {!driverPricing.hidden ? (
                                                <div className="text-right">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase">
                                                        {driverPricing.available ? 'Tarifa oficial' : 'Tarifa'}
                                                    </p>
                                                    <p className="text-2xl font-black text-slate-800">
                                                        {driverPricing.available
                                                            ? formatTripLogixMoney(driverPricing.total, driverPricing.currency)
                                                            : 'Calculando...'}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                                                        {driverPricing.source}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="text-right max-w-[130px]">
                                                    <p className="text-[10px] font-black text-blue-600 uppercase">Servicio corporativo</p>
                                                    <p className="text-[10px] font-bold text-slate-400 mt-1">Tarifa administrada por despacho</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {viaje.driver && (
                                    <button
                                        type="button"
                                        onClick={() => openDriverDetails(viaje)}
                                        className="w-full mt-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-black p-3.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
                                    >
                                        <User className="w-4 h-4 text-orange-500" /> DATOS DEL CONDUCTOR
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => compartirSeguimiento(viaje)}
                                    className="w-full mt-4 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 font-black p-3.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Share2 className="w-4 h-4" /> COMPARTIR SEGUIMIENTO
                                </button>
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
                          <div className="text-right"><p className="text-[10px] font-bold text-slate-400 uppercase">Total</p><p className="text-sm font-black text-slate-800">${buildTripLogixReceipt(viaje).pricing.total.toFixed(2)}</p></div>
                      )}
                    </div>
                    <div className={`relative pl-3 border-l-2 space-y-3 mb-2 ml-1 ${viaje.status === 'Cancelado' ? 'border-red-100 opacity-60' : 'border-slate-100'}`}>
                      <div className="relative"><div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-green-500'}`}></div><p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.start || '').split(',')[0]}</p></div>
                      <div className="relative"><div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${viaje.status === 'Cancelado' ? 'bg-red-300' : 'bg-orange-500'}`}></div><p className="text-xs font-medium text-slate-700 line-clamp-1">{(viaje.end || '').split(',')[0]}</p></div>
                    </div>
                    {viaje.status === 'Finalizado' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                        <button
                          type="button"
                          onClick={() => downloadTripLogixReceiptPdf(viaje)}
                          className="p-3 rounded-xl bg-orange-500 text-white font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition"
                        >
                          <Download className="w-4 h-4" /> Recibo PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => shareTripLogixReceiptPdf(viaje)}
                          className="p-3 rounded-xl bg-slate-800 text-white font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition"
                        >
                          <Share2 className="w-4 h-4" /> Compartir
                        </button>
                        {!isCorporate && !['Pagado', 'paid', 'Completado'].includes(String(viaje.paymentStatus || '')) && (
                          <button
                            type="button"
                            onClick={() => openPaymentForTrip(viaje)}
                            className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-green-600 text-white font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition"
                          >
                            <CreditCard className="w-4 h-4" /> Ir a pagos
                          </button>
                        )}
                      </div>
                    )}
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

                {selectedPaymentTripId && (() => {
                    const paymentTrip = misViajes.find(item => item.id === selectedPaymentTripId);
                    if (!paymentTrip) return null;
                    const receipt = buildTripLogixReceipt(paymentTrip);
                    return (
                        <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Viaje seleccionado</p>
                            <p className="text-sm font-bold text-slate-800 mt-1">{(paymentTrip.start || 'Origen').split(',')[0]} → {(paymentTrip.end || 'Destino').split(',')[0]}</p>
                            <p className="text-xl font-black text-green-700 mt-2">${Number(receipt.pricing.total || 0).toFixed(2)}</p>
                            <p className="text-[10px] font-bold text-slate-500 mt-1">Vincula o revisa tu método de pago. El cargo automático requiere el backend de cobro de Stripe.</p>
                        </div>
                    );
                })()}


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

export default function TripLogixClientRoot() {
  return (
    <TripLogixClientErrorBoundary>
      <App />
    </TripLogixClientErrorBoundary>
  );
}