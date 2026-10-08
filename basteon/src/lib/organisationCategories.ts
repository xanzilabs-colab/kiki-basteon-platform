export type OrganisationOption = { value: string; label: string };
export type MembershipTypeOption = { value: string; label: string };

export const INSTITUTION_KIND_OPTIONS: OrganisationOption[] = [
  { value: "university", label: "University" },
  { value: "college", label: "College" },
  { value: "school", label: "School" },
  { value: "other", label: "Other" },
];

export const BUSINESS_INDUSTRY_OPTIONS: OrganisationOption[] = [
  { value: "residential_estate", label: "Residential estate / HOA" },
  { value: "property_management", label: "Property management" },
  { value: "retail", label: "Retail" },
  { value: "hospitality", label: "Hospitality / Hotel" },
  { value: "food_beverage", label: "Food & beverage" },
  { value: "education_services", label: "Education services" },
  { value: "healthcare", label: "Healthcare / Clinic" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "logistics_transport", label: "Logistics & transport" },
  { value: "mining_energy", label: "Mining / Energy" },
  { value: "construction", label: "Construction" },
  { value: "agriculture", label: "Agriculture" },
  { value: "technology", label: "Technology / ICT" },
  { value: "financial_services", label: "Financial services" },
  { value: "public_sector", label: "Public sector / Government" },
  { value: "non_profit", label: "Non-profit / NGO" },
  { value: "events_venues", label: "Events / Venue management" },
  { value: "aviation", label: "Aviation" },
  { value: "maritime", label: "Maritime" },
  { value: "other", label: "Other" },
];

export const RESPONDER_CATEGORY_OPTIONS: OrganisationOption[] = [
  { value: "private_security", label: "Private security" },
  { value: "armed_response", label: "Armed response" },
  { value: "medical_response", label: "Medical response / EMS" },
  { value: "fire_rescue", label: "Fire & rescue" },
  { value: "campus_security", label: "Campus security" },
  { value: "estate_security", label: "Residential estate security" },
  { value: "event_security", label: "Event security" },
  { value: "control_room", label: "Control room operator" },
  { value: "community_patrol", label: "Community patrol / CPF" },
  { value: "investigations", label: "Investigations" },
  { value: "close_protection", label: "Close protection" },
  { value: "drone_unit", label: "Drone response unit" },
  { value: "search_rescue", label: "Search & rescue" },
  { value: "other", label: "Other" },
];

export const ORGANISATION_CATEGORY_OPTIONS: OrganisationOption[] = [
  { value: "residential_estate", label: "Residential estate" },
  { value: "school", label: "School" },
  { value: "higher_education", label: "Higher education" },
  { value: "hospital", label: "Hospital / healthcare" },
  { value: "corporate_office", label: "Corporate office" },
  { value: "retail_centre", label: "Retail centre / mall" },
  { value: "warehouse_logistics", label: "Warehouse / logistics" },
  { value: "industrial_plant", label: "Industrial plant" },
  { value: "mine_energy_site", label: "Mine / energy site" },
  { value: "hospitality_venue", label: "Hospitality venue" },
  { value: "government_facility", label: "Government facility" },
  { value: "transport_hub", label: "Transport hub" },
  { value: "events_venue", label: "Events venue" },
  { value: "faith_based", label: "Faith-based organisation" },
  { value: "non_profit_ngo", label: "Non-profit / NGO" },
  { value: "security_partner", label: "Security partner" },
  { value: "medical_partner", label: "Medical partner" },
  { value: "community_network", label: "Community safety network" },
  { value: "other", label: "Other" },
];

const BASE_MEMBER_TYPES: MembershipTypeOption[] = [
  { value: "staff", label: "Staff" },
  { value: "responder", label: "Responder" },
  { value: "member", label: "Member" },
];

const INSTITUTION_MEMBER_TYPES: MembershipTypeOption[] = [
  { value: "student", label: "Student" },
  { value: "staff", label: "Staff" },
  { value: "faculty", label: "Faculty / Lecturer" },
  { value: "responder", label: "Responder / Security" },
  { value: "member", label: "General member" },
];

const ESTATE_MEMBER_TYPES: MembershipTypeOption[] = [
  { value: "resident", label: "Resident" },
  { value: "staff", label: "Estate staff" },
  { value: "responder", label: "Responder / Security" },
  { value: "contractor", label: "Contractor" },
  { value: "visitor", label: "Visitor" },
];

const HEALTH_MEMBER_TYPES: MembershipTypeOption[] = [
  { value: "staff", label: "Clinical / support staff" },
  { value: "responder", label: "Emergency responder" },
  { value: "patient", label: "Patient" },
  { value: "member", label: "General member" },
];

const SCHOOL_MEMBER_TYPES: MembershipTypeOption[] = [
  { value: "student", label: "Student / learner" },
  { value: "staff", label: "Staff" },
  { value: "responder", label: "Responder / Security" },
  { value: "parent_guardian", label: "Parent / guardian" },
];

type OrganisationContext = {
  organisation_type?: string | null;
  category?: string | null;
  institution_kind?: string | null;
  business_category?: string | null;
  responder_category?: string | null;
};

export function membershipTypeOptionsForOrganisation(context: OrganisationContext): MembershipTypeOption[] {
  const type = context.organisation_type ?? "";
  const category = context.category ?? "";
  const business = context.business_category ?? "";
  const responder = context.responder_category ?? "";

  if (type === "institution" || category === "school" || category === "higher_education") return INSTITUTION_MEMBER_TYPES;
  if (category === "residential_estate" || business === "residential_estate" || responder === "estate_security") return ESTATE_MEMBER_TYPES;
  if (category === "hospital" || business === "healthcare" || responder === "medical_response") return HEALTH_MEMBER_TYPES;
  if (category === "school" || category === "higher_education") return SCHOOL_MEMBER_TYPES;
  if (type === "business") return BASE_MEMBER_TYPES;
  if (type === "responder_partner") return [
    { value: "responder", label: "Responder" },
    { value: "staff", label: "Staff" },
    { value: "dispatcher", label: "Dispatcher" },
    { value: "member", label: "General member" },
  ];
  return BASE_MEMBER_TYPES;
}

export function roleHintForMembershipType(membershipType: string): string {
  if (membershipType === "responder" || membershipType === "dispatcher") return "responder";
  if (membershipType === "staff" || membershipType === "faculty") return "member";
  if (membershipType === "resident" || membershipType === "student" || membershipType === "patient" || membershipType === "member") return "member";
  return "member";
}
