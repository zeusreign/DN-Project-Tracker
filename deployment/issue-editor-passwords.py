#!/usr/bin/env python3
"""Run by a DNC Administrator. Passwords stay in an owner-readable local file.
Default: review the explicitly listed Editors. --apply installs prepared
first-time credentials only. Existing passwords are never reset.
"""
import argparse, getpass, http.cookiejar, json, os, secrets, sys
from pathlib import Path
from urllib.request import build_opener, HTTPCookieProcessor, Request, HTTPRedirectHandler
from urllib.parse import urlsplit

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def eligible(user):
    return user.get('role') == 'editor' and user.get('account_status') != 'suspended' and user.get('site_access_status') not in ('revoked','email_required') and not user.get('password_configured') and bool(user.get('username') or user.get('user_email'))

def new_password():
    return 'Dnc!' + secrets.token_urlsafe(18) + '7aA'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True, help='Exact HTTPS Tracker origin (staging or production)')
    p.add_argument('--admin', required=True, help='Existing administrator login email')
    p.add_argument('--apply', action='store_true', help='Install the listed first-time passwords; never replace an existing password')
    p.add_argument('--credentials', required=True, help='TJ’s prepared private credentials JSON')
    p.add_argument('--activate-pending', action='store_true', help='Activate listed pending Editor accounts for the authorized testing week')
    p.add_argument('--out', default='editor-credentials-private.json')
    a=p.parse_args(); u=urlsplit(a.url)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):
        p.error('--url must be an HTTPS origin, without a path, query or credentials')
    prepared=json.loads(Path(a.credentials).read_text()); targets={x['username'].lower():x for x in prepared['users']}
    if len(targets)!=len(prepared['users']): p.error('Duplicate usernames in credentials file')
    origin=a.url.rstrip('/'); cookies=http.cookiejar.CookieJar(); opener=build_opener(NoRedirect(), HTTPCookieProcessor(cookies)); csrf=None
    def api(path, body=None):
        headers={'Origin':origin,'Accept':'application/json','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
        if body is not None: headers['Content-Type']='application/json'
        if csrf: headers['x-csrf-token']=csrf
        req=Request(origin+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
        with opener.open(req, timeout=40) as r:
            if 'application/json' not in r.headers.get('Content-Type',''): raise RuntimeError('Unexpected response; no credentials were forwarded to another site')
            return json.load(r)
    api('/api/login',{'username':a.admin,'password':getpass.getpass('Administrator password (hidden): ')})
    try:
        boot=api('/api/bootstrap'); me=boot['me']; csrf=me.get('csrf_token')
        if me.get('role')!='admin' or me.get('must_change_password'): raise RuntimeError('Use an active Administrator who has completed the initial password change')
        roster=api('/api/admin')['roles']; listed=[x for x in roster if (x.get('username') or x.get('user_email') or '').lower() in targets]; users=[x for x in listed if eligible(x) and (a.activate_pending or x.get('account_status')=='active' and x.get('site_access_status')=='authorized')]
        missing=set(targets)-{(x.get('username') or x.get('user_email') or '').lower() for x in listed}
        if missing: raise RuntimeError('Prepared usernames absent from the live directory: '+', '.join(sorted(missing)))
        skipped=[{'name':x.get('first_name','')+' '+x.get('last_name',''),'email':x.get('user_email'),'reason':'Existing password, changed role, blocked access, or pending activation; left unchanged'} for x in listed if x not in users]
        print(json.dumps({'site':origin,'eligible_editors':[{'name':x['first_name']+' '+x['last_name'],'email':x['user_email'],'scope':x['business_unit_scope']} for x in users],'skipped_editors':skipped},indent=2))
        if not a.apply:
            print('Read-only roster review. Use --apply after checking this list.'); return
        out=Path(a.out).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
        fd=os.open(out, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.close(fd)
        packet={'site':origin,'handling':'TJ and Faheem only. Share each user only their own credential. Required change at first login. No automatic expiry is implemented.','users':[],'skipped_editors':skipped}
        def save():
            with out.open('w') as f: json.dump(packet,f,indent=2);f.flush();os.fsync(f.fileno())
        save()
        for old in users:
            # Refresh each record to avoid overwriting another administrator's changes.
            latest=next((x for x in api('/api/admin')['roles'] if x['id']==old['id']),None)
            if not latest or not eligible(latest): raise RuntimeError('Editor eligibility changed; stopped. Inspect the private result file.')
            password=targets[(latest.get('username') or latest['user_email']).lower()]['temporary_password']; entry={'name':latest['first_name']+' '+latest['last_name'],'username':latest.get('username') or latest['user_email'],'temporary_password':password,'status':'prepared; activation not confirmed'}
            packet['users'].append(entry); save()
            payload={'expected_email':entry['username'],'temporary_password':password,'activate_pending':a.activate_pending}
            api('/api/admin/users/'+str(latest['id'])+'/initial-password',payload)
            entry['status']='activated; must change on first login';save()
        print('Installed '+str(len(packet['users']))+' first-time Editor passwords. Private credentials file: '+str(out))
    finally:
        try: api('/api/logout',{})
        except Exception: pass

if __name__=='__main__':
    try: main()
    except Exception as e:
        print('Stopped: '+str(e)+'. If --apply was used, inspect the private output file before retrying.',file=sys.stderr);sys.exit(1)
