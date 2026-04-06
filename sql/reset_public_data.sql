-- Destructive reset of app data in the public schema.
-- Keeps the schema, functions, and views in place, but removes row data and
-- resets identities so the app can start fresh.

truncate table
  public.remnant_sales,
  public.notification_queue,
  public.hold_requests,
  public.holds,
  public.audit_logs,
  public.remnant_colors,
  public.stone_product_colors,
  public.slab_colors,
  public.slab_finishes,
  public.slab_thicknesses,
  public.supplier_materials,
  public.supplier_terms,
  public.supplier_contacts,
  public.supplier_locations,
  public.supplier_brands,
  public.remnants,
  public.slabs,
  public.stone_products,
  public.colors,
  public.finishes,
  public.suppliers,
  public.profiles,
  public.thicknesses,
  public.materials,
  public.companies
restart identity cascade;
