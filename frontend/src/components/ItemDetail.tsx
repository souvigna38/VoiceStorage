"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  StarIcon,
  MapPinIcon,
  TagIcon,
  ArrowsRightLeftIcon,
  ClockIcon,
  WrenchScrewdriverIcon,
  ShieldCheckIcon,
  CubeIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  PrinterIcon,
  CurrencyDollarIcon,
} from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import type { ProductDetail, Location } from "@/lib/types";
import LocationSelector from "./LocationSelector";
import EditItemModal from "./EditItemModal";
import ListForSaleModal from "./ListForSaleModal";
import ItemImageGallery from "./item-detail/ItemImageGallery";
import ItemPricing from "./item-detail/ItemPricing";
import ItemLogistics from "./item-detail/ItemLogistics";
import ItemHardwareSpecs from "./item-detail/ItemHardwareSpecs";
import ItemAIInsights from "./item-detail/ItemAIInsights";
import ItemResearch from "./item-detail/ItemResearch";
import ItemActivityLog from "./item-detail/ItemActivityLog";

interface ItemDetailProps {
  product: ProductDetail;
  locations: Location[];
}

const STATUS_STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  available: { bg: "bg-green-50 border-green-200", dot: "bg-green-500", label: "Available" },
  checked_out: { bg: "bg-yellow-50 border-yellow-200", dot: "bg-yellow-500", label: "Checked Out" },
  maintenance: { bg: "bg-orange-50 border-orange-200", dot: "bg-orange-500", label: "Maintenance" },
  storage: { bg: "bg-blue-50 border-blue-200", dot: "bg-blue-500", label: "Storage" },
  archived: { bg: "bg-gray-50 border-gray-300", dot: "bg-gray-400", label: "Archived" },
  lost: { bg: "bg-red-50 border-red-200", dot: "bg-red-500", label: "Lost" },
  disposed: { bg: "bg-gray-50 border-gray-300", dot: "bg-gray-300", label: "Disposed" },
};

export default function ItemDetail({ product, locations }: ItemDetailProps) {
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(product.image_url);
  const [isCorrectingAi, setIsCorrectingAi] = useState(false);
  const [correctionResult, setCorrectionResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [isLookingUpMsrp, setIsLookingUpMsrp] = useState(false);
  const [msrpResult, setMsrpResult] = useState<{ success: boolean; msrp?: number | null; message?: string; error?: string } | null>(null);
  const [isSaleModalOpen, setIsSaleModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleMsrpLookup = async () => {
    setIsLookingUpMsrp(true);
    setMsrpResult(null);
    try {
      const resp = await fetch("/api/msrp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: product.id }),
      });
      const data = await resp.json();
      setMsrpResult(data);
      if (data.success && data.msrp) {
        // Refresh to show updated MSRP
        window.location.reload();
      }
    } catch (err) {
      setMsrpResult({ success: false, error: err instanceof Error ? err.message : "Lookup failed" });
    } finally {
      setIsLookingUpMsrp(false);
    }
  };

  const allImages = product.images.length > 0
    ? product.images.map((img) => img.image_url)
    : product.image_url
    ? [product.image_url]
    : [];

  const status = STATUS_STYLES[product.status] || STATUS_STYLES.available;

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, i) =>
      i < Math.round(rating) ? (
        <StarIcon key={i} className="h-5 w-5 text-[#febd69]" />
      ) : (
        <StarOutline key={i} className="h-5 w-5 text-[#febd69]" />
      )
    );

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <div className="max-w-screen-xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          {/* ===== TOP SECTION: Image + Core Info ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            {/* Left: Image Gallery */}
            <ItemImageGallery
              selectedImage={selectedImage}
              setSelectedImage={setSelectedImage}
              allImages={allImages}
              productTitle={product.title}
            />

            {/* Right: Product Info */}
            <div className="p-6 md:p-8">
              {/* Title */}
              <h1 className="text-xl md:text-2xl font-medium text-[#0f1111] mb-2 leading-tight">
                {product.title}
              </h1>

              {/* Manufacturer / Model */}
              {(product.manufacturer || product.model_name) && (
                <p className="text-sm text-[#007185] mb-2">
                  {[product.manufacturer, product.model_name]
                    .filter(Boolean)
                    .join(" · ")}
                  {product.model_number && (
                    <span className="text-gray-400 ml-1">({product.model_number})</span>
                  )}
                </p>
              )}

              {/* Rating */}
              <div className="flex items-center mb-3">
                <span className="text-sm text-[#c45500] font-medium mr-1">
                  {product.rating.toFixed(1)}
                </span>
                <div className="flex">{renderStars(product.rating)}</div>
                <span className="text-sm text-[#007185] ml-2">
                  {product.rating_count} rating{product.rating_count !== 1 ? "s" : ""}
                </span>
              </div>

              <hr className="my-3 border-gray-200" />

              {/* Price / Value — All Prices Grid */}
              <ItemPricing
                product={product}
                isLookingUpMsrp={isLookingUpMsrp}
                handleMsrpLookup={handleMsrpLookup}
                msrpResult={msrpResult}
              />

              {/* Medusa Listing Badge */}
              {product.medusa_product_id && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="bg-emerald-500 rounded-full p-1.5">
                    <CurrencyDollarIcon className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-grow">
                    <p className="text-sm font-bold text-emerald-700">Listed for Sale</p>
                    <p className="text-[10px] text-emerald-500 font-mono">{product.medusa_product_id}</p>
                  </div>
                  <a
                    href="http://localhost:9500/app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline font-medium"
                  >
                    Manage
                  </a>
                </div>
              )}

              {/* Status Badge */}
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium mb-4 ${status.bg}`}>
                <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                {status.label}
                {product.assigned_to_name && (
                  <span className="text-gray-500 font-normal">
                    — assigned to {product.assigned_to_name}
                  </span>
                )}
              </div>

              {/* ===== LOGISTICS — QR Code + Asset Tag (Amazon License Plate) ===== */}
              <ItemLogistics product={product} />

              {/* Hardware Specs — CPU / RAM / Storage / GPU / Network */}
              <ItemHardwareSpecs product={product} />

              {/* Key Details Grid */}
              <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
                {product.asset_tag && (
                  <div className="flex items-center gap-2">
                    <TagIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase">Asset Tag</p>
                      <p className="font-mono text-[#0f1111]">{product.asset_tag}</p>
                    </div>
                  </div>
                )}
                {product.serial_number && (
                  <div className="flex items-center gap-2">
                    <CubeIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase">Serial Number</p>
                      <p className="font-mono text-[#0f1111]">{product.serial_number}</p>
                    </div>
                  </div>
                )}
                {product.location_name && (
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="h-4 w-4 text-[#c45500] flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase">Current Location</p>
                      <p className="text-[#0f1111]">{product.location_name}</p>
                    </div>
                  </div>
                )}
                {product.category_name && (
                  <div className="flex items-center gap-2">
                    <DocumentTextIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase">Category</p>
                      <p className="text-[#0f1111]">{product.category_name}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Quantity</p>
                    <p className="text-[#0f1111]">{product.quantity}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Check-outs</p>
                    <p className="text-[#0f1111]">{product.checkout_counter} times</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                {/* List for Sale / Manage Listing Button */}
                <button
                  onClick={() => setIsSaleModalOpen(true)}
                  className={`w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition cursor-pointer ${
                    product.medusa_product_id
                      ? "bg-gradient-to-b from-emerald-400 to-emerald-500 border border-emerald-600 hover:from-emerald-500 hover:to-emerald-600 text-white"
                      : "bg-gradient-to-b from-emerald-500 to-teal-600 border border-emerald-700 hover:from-emerald-600 hover:to-teal-700 text-white"
                  }`}
                >
                  <CurrencyDollarIcon className="h-5 w-5" />
                  {product.medusa_product_id ? "Manage Listing" : "List for Sale"}
                </button>

                <button
                  onClick={() => setShowLocationModal(true)}
                  disabled={product.status === "retired"}
                  className={`w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition ${
                    product.status === "retired"
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                      : "bg-gradient-to-b from-[#f7dfa5] to-[#f0c14b] border border-[#a88734] hover:from-[#f0c14b] hover:to-[#e7a321] text-[#111] cursor-pointer"
                  }`}
                >
                  <ArrowsRightLeftIcon className="h-5 w-5" />
                  Move / Transfer
                </button>
                <button
                  onClick={() => setIsEditOpen(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition bg-white border-2 border-gray-300 text-[#0f1111] hover:bg-gray-50 hover:border-gray-400 cursor-pointer"
                >
                  <PencilSquareIcon className="h-5 w-5 text-gray-500" />
                  Edit Specs
                </button>
                {product.asset_tag && (
                  <Link
                    href={`/seller/print/${product.id}`}
                    className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition bg-white border-2 border-gray-300 text-[#0f1111] hover:bg-gray-50 hover:border-gray-400"
                  >
                    <PrinterIcon className="h-5 w-5 text-gray-500" />
                    Print Label
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* ===== DESCRIPTION SECTION ===== */}
          {product.description && (
            <div className="border-t border-gray-100 p-6 md:p-8">
              <h2 className="text-lg font-bold text-[#0f1111] mb-3">About this item</h2>
              <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                {product.description}
              </div>
            </div>
          )}

          {/* ===== AI INSIGHTS CARD ===== */}
          <ItemAIInsights
            product={product}
            isCorrectingAi={isCorrectingAi}
            setIsCorrectingAi={setIsCorrectingAi}
            correctionResult={correctionResult}
            setCorrectionResult={setCorrectionResult}
            isPending={isPending}
            startTransition={startTransition}
          />

          {/* ===== AI RESEARCH CARD ===== */}
          <ItemResearch product={product} />

          {/* ===== SPECIFICATIONS TABLE ===== */}
          <div className="border-t border-gray-100 p-6 md:p-8">
            <h2 className="text-lg font-bold text-[#0f1111] mb-3">
              <WrenchScrewdriverIcon className="h-5 w-5 inline mr-2 text-gray-400" />
              Technical Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden text-sm">
              {[
                ["Manufacturer", product.manufacturer],
                ["Model", product.model_name],
                ["Model Number", product.model_number],
                ["Serial Number", product.serial_number],
                ["Asset Tag", product.asset_tag],
                ["CPU / Processor", product.cpu_type],
                ["RAM / Memory", product.ram_amount],
                ["Storage / Hard Drive", product.hard_drive_info],
                ["GPU", product.gpu],
                ["Network", product.network_info],
                ["Role", product.role],
                ["Category", product.category_name],
                ["Status", status.label],
                ["Current Location", product.location_name],
                ["Default Location", product.default_location_name],
                ["Assigned To", product.assigned_to_name],
                ["Quantity", product.quantity?.toString()],
                ["Purchase Date", formatDate(product.purchase_date)],
                ["Purchase Price", product.price > 0 ? `$${product.price.toFixed(2)}` : null],
                ["Estimated Value", product.estimated_value != null && product.estimated_value > 0 ? `$${product.estimated_value.toFixed(2)}` : null],
                ["MSRP", product.msrp_price != null && product.msrp_price > 0 ? `$${product.msrp_price.toFixed(2)}` : null],
                ["List Price", product.list_price != null && product.list_price > 0 ? `$${product.list_price.toFixed(2)}` : null],
                ["Sold Price", product.sold_price != null && product.sold_price > 0 ? `$${product.sold_price.toFixed(2)}` : null],
                ["Sold Date", product.sold_date ? new Date(product.sold_date).toLocaleDateString() : null],
                ["Supplier", product.supplier],
                ["Order Number", product.order_number],
                ["Warranty", product.warranty_months ? `${product.warranty_months} months` : null],
                ["Warranty Expires", formatDate(product.warranty_expires)],
                ["Last Check-out", formatDateTime(product.last_checkout)],
                ["Last Check-in", formatDateTime(product.last_checkin)],
                ["Check-out Count", product.checkout_counter.toString()],
                ["Added", formatDateTime(product.created_at)],
                ["Last Updated", formatDateTime(product.updated_at)],
              ]
                .filter(([, val]) => val && val !== "—" && val !== "null")
                .map(([label, value], i) => (
                  <div
                    key={label}
                    className={`flex border-b border-gray-200 last:border-b-0 ${
                      i % 2 === 0 ? "md:border-r" : ""
                    }`}
                  >
                    <span className="w-40 flex-shrink-0 bg-gray-50 px-4 py-2.5 font-medium text-gray-600 border-r border-gray-200">
                      {label}
                    </span>
                    <span className="px-4 py-2.5 text-[#0f1111] flex-grow">
                      {value}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* ===== NOTES ===== */}
          {product.notes && (
            <div className="border-t border-gray-100 p-6 md:p-8">
              <h2 className="text-lg font-bold text-[#0f1111] mb-3">
                <DocumentTextIcon className="h-5 w-5 inline mr-2 text-gray-400" />
                Notes
              </h2>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line">
                {product.notes}
              </div>
            </div>
          )}

          {/* ===== WARRANTY INFO ===== */}
          {product.warranty_months && (
            <div className="border-t border-gray-100 p-6 md:p-8">
              <h2 className="text-lg font-bold text-[#0f1111] mb-3">
                <ShieldCheckIcon className="h-5 w-5 inline mr-2 text-green-500" />
                Warranty
              </h2>
              <div className="flex items-center gap-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <p className="text-green-800 font-medium">
                    {product.warranty_months} month warranty
                  </p>
                  {product.warranty_expires && (
                    <p className="text-green-600 text-xs mt-0.5">
                      Expires: {formatDate(product.warranty_expires)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===== ACTIVITY LOG (replaces "Customer Reviews") ===== */}
          <ItemActivityLog
            actionLogs={product.action_logs}
            formatDateTime={formatDateTime}
          />
        </div>
      </div>

      {/* Location Selector Modal */}
      {showLocationModal && (
        <LocationSelector
          item={product}
          locations={locations}
          onClose={() => setShowLocationModal(false)}
        />
      )}

      {/* Edit Item Modal */}
      <EditItemModal
        item={product}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />

      {/* List for Sale Modal (Medusa) */}
      <ListForSaleModal
        item={product}
        isOpen={isSaleModalOpen}
        onClose={() => setIsSaleModalOpen(false)}
      />
    </>
  );
}
