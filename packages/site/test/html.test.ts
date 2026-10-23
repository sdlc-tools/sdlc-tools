import { describe, expect, it } from 'vitest';
import { escapeHtml, markup, raw } from '../src/html.js';

describe('html', () => {
  it('escapes interpolated text and attribute values', () => {
    const hostile = `"><script>alert('x')</script> & more`;
    expect(markup`<a title="${hostile}">${hostile}</a>`.toString()).toBe(
      `<a title="&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; more">&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; more</a>`,
    );
  });

  it('keeps markup built by html and drops empty values', () => {
    const inner = markup`<b>${'1 < 2'}</b>`;
    expect(markup`${inner}${false}${null}${undefined}${[1, markup`<i></i>`]}`.toString()).toBe(
      '<b>1 &lt; 2</b>1<i></i>',
    );
  });

  it('trusts only raw markup', () => {
    expect(markup`${raw('<br>')}`.toString()).toBe('<br>');
    expect(escapeHtml('<br>')).toBe('&lt;br&gt;');
  });
});
