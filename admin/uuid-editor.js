import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const drawer = document.querySelector('#customer-drawer');
const actions = drawer?.querySelector('.drawer-actions');

if (config && drawer && actions) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { detectSessionInUrl: false } });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button quiet';
  button.textContent = 'Set / Repair UUID';
  button.title = 'Fill a missing purchaser avatar UUID on this customer, license, and purchase record.';
  actions.insertBefore(button, actions.firstChild?.nextSibling || actions.firstChild);

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const identity = drawerIdentity();
      const customer = await resolveCustomer(identity);
      if (!customer) throw new Error('Could not uniquely match this Back Office customer record.');

      const currentUuid = isUuid(identity.uuid) ? identity.uuid : (isUuid(customer.primary_avatar_uuid) ? customer.primary_avatar_uuid : '');
      const entered = prompt('Avatar UUID to apply to this customer and any missing purchase/license UUID fields:', currentUuid || '');
      if (entered == null) return;
      const avatarUuid = entered.trim().toLowerCase();
      if (!isUuid(avatarUuid)) throw new Error('That is not a valid avatar UUID.');

      const reason = prompt('Reason for this correction:', 'Manual Back Office correction') ?? '';
      if (!reason.trim()) return;

      if (!confirm(`Apply ${avatarUuid} to ${identity.name || customer.primary_avatar_name || 'this customer'} and fill any missing purchaser UUID fields on linked licenses/purchases?`)) return;

      const { data, error } = await supabase.rpc('admin_fill_missing_purchaser_uuid', {
        p_customer_id: customer.id,
        p_avatar_uuid: avatarUuid,
        p_reason: reason.trim(),
      });
      if (error) throw error;

      const licensesUpdated = Number(data?.licenses_updated || 0);
      const purchasesUpdated = Number(data?.purchases_updated || 0);
      alert(`UUID saved. Updated ${licensesUpdated} license record${licensesUpdated === 1 ? '' : 's'} and ${purchasesUpdated} purchase record${purchasesUpdated === 1 ? '' : 's'}.`);
      location.reload();
    } catch (error) {
      alert(error?.message || 'Could not update the UUID.');
    } finally {
      button.disabled = false;
    }
  });

  function drawerIdentity() {
    const name = document.querySelector('#drawer-name')?.textContent?.trim() || '';
    const uuidText = document.querySelector('#drawer-uuid')?.textContent?.trim() || '';
    let email = '';
    for (const chip of drawer.querySelectorAll('.summary-chip')) {
      const label = chip.querySelector('span')?.textContent?.trim().toLowerCase();
      if (label === 'email') {
        const value = chip.querySelector('strong')?.textContent?.trim() || '';
        if (value && value.toLowerCase() !== 'not recorded') email = value;
      }
    }
    return { name, uuid: uuidText, email };
  }

  async function resolveCustomer(identity) {
    if (isUuid(identity.uuid)) {
      const { data, error } = await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').eq('primary_avatar_uuid', identity.uuid).limit(2);
      if (error) throw error;
      if (data?.length === 1) return data[0];
    }

    if (identity.email) {
      const { data, error } = await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').ilike('email', identity.email).limit(2);
      if (error) throw error;
      if (data?.length === 1) return data[0];
    }

    if (identity.name) {
      const { data, error } = await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').eq('primary_avatar_name', identity.name).limit(2);
      if (error) throw error;
      if (data?.length === 1) return data[0];
    }

    return null;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
  }
}
