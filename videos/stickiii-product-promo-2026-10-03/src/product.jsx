import './fixtures/desktop.js';
import React from 'react';
import App from '@product/App.tsx';
export function Product({noteId,theme='paper',main=false,className='',width=440,height=330}) {
  return <div className={'product-pos '+className} data-product={noteId}>
    <div className="product-camera"><div className="product-root film-product" data-page-theme={theme} style={{width,height}}>
      <App context={{noteId:main?null:noteId,openNoteIds:[],readyNoteIds:[],pinned:false}} />
    </div></div>
  </div>;
}
