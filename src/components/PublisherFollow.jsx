import React, {useEffect, useId, useRef, useState} from 'react';
import {Check, Copy, Download, QrCode, X} from 'lucide-react';
import qrImage from '../assets/publisher-wechat-qr.png';

const accountName = '汤姆喵的奇妙旅行';

export default function PublisherFollow() {
  const [copyState, setCopyState] = useState('idle');
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null), triggerRef = useRef(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current, previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus({preventScroll: true});
    };
  }, [open]);
  async function copyName() {
    try {
      await navigator.clipboard.writeText(accountName);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  }
  return <section className="publisher-follow" aria-label="关注作者公众号">
    <div className="publisher-follow-copy">
      <span className="publisher-follow-label">公众号</span>
      <strong>{accountName}</strong>
      <span className="publisher-follow-hint">关注我，一起把 QDII 投资弄明白</span>
    </div>
    <button ref={triggerRef} type="button" className="publisher-follow-button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <QrCode size={16}/>扫码关注
    </button>
    <dialog ref={dialogRef} className="publisher-qr-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => {event.preventDefault(); setOpen(false);}}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false);
      }}>
      <button type="button" className="publisher-qr-close icon-button" aria-label="关闭公众号二维码" onClick={() => setOpen(false)}><X size={20}/></button>
      <p className="publisher-qr-eyebrow">微信扫一扫 · 关注工具作者</p>
      <h2 id={titleId}>{accountName}</h2>
      <p className="publisher-qr-subtitle">一起把 QDII 投资弄明白</p>
      <img className="publisher-qr-image" src={qrImage} width="430" height="430" alt="汤姆喵的奇妙旅行微信公众号关注二维码"/>
      <p id={descriptionId} className="publisher-qr-instructions">用微信扫码关注<br/>微信内可长按识别，或保存图片后用微信扫一扫。</p>
      <div className="publisher-qr-actions">
        <a href={qrImage} download="汤姆喵的奇妙旅行-公众号二维码.png"><Download size={15}/>保存二维码</a>
        <button type="button" onClick={copyName} aria-label="复制公众号名称，去微信关注">{copyState === 'copied' ? <Check size={15}/> : <Copy size={15}/>}{copyState === 'copied' ? '已复制名称' : '复制公众号名称'}</button>
      </div>
      <p className="publisher-qr-status" role="status">{copyState === 'copied' ? '已复制，去微信搜索并关注' : copyState === 'manual' ? '请长按或选中上方名称，到微信搜索' : ''}</p>
    </dialog>
  </section>;
}
